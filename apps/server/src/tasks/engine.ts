import { listRunSummaries } from './run-summaries.js';
import type { RunListQuery, RunListResponse } from '../../../../packages/shared/src/index.js';
import { taskInput, nextOccurrence } from './configuration.js';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { RunEvent, RunRecord, RunStatus, TaskRecord, TaskConfiguration, TurnRecord } from '../../../../packages/shared/src/index.js';
import { AppError, HttpError } from '../errors.js';
import { AgentError, type AgentAdapter, type AgentEvent } from '../agent/types.js';
import type { TaskWorkflow } from './workflow.js';
import { NEWS_TASK_ID } from '../news/source.js';

interface EngineOptions {
  adapter: AgentAdapter; concurrency: number; maxQueue: number; timeoutMs: number;
  cwd: string; model?: string; onFatal?: () => void;
  workflows?: ReadonlyMap<string, TaskWorkflow>;
  onAutomaticPublish?: (reportId:string,signal:AbortSignal)=>Promise<void>;
}
interface Work { runId: string; turnId: string; input: string; threadId?: string }
interface Slot { controller: AbortController; done: Promise<void>; reason?: 'cancelled' | 'timeout' | 'backend_stopped' }
const ACTIVE = "('queued','running','waiting_approval')";
const now = () => new Date().toISOString();
const validId = (value: string) => typeof value === 'string' && value.length > 0 && value.length <= 256;
function key(value: string): void {
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(value)) throw new HttpError(400, 'invalid_idempotency_key');
}
function inputText(value: string): void {
  if (typeof value !== 'string' || !value.trim() || value.length > 8000) throw new HttpError(400, 'invalid_input');
}

export class TaskEngine {
  private queue: Work[] = [];
  private active = new Map<string, Slot>();
  private stopping = false;
  private fatal = false;
  private closing?: Promise<void>;

  constructor(private db: DatabaseSync, private options: EngineOptions) {
    this.transaction(() => {
      const unfinished = db.prepare(`SELECT id FROM task_runs WHERE status IN ${ACTIVE}
        OR id IN (SELECT run_id FROM run_turns WHERE status IN ${ACTIVE})`).all();
      for (const row of unfinished) {
        const runId = String(row.id);
        db.prepare("UPDATE task_runs SET status='interrupted',error_code='backend_restarted',finished_at=?,updated_at=? WHERE id=?").run(now(), now(), runId);
        db.prepare(`UPDATE run_turns SET status='interrupted',error_code='backend_restarted',finished_at=? WHERE run_id=? AND status IN ${ACTIVE}`).run(now(), runId);
        this.event(runId, null, 'recovered', { code: 'backend_restarted' });
      }
      db.prepare(`INSERT OR IGNORE INTO tasks(id,name,channel,prompt) VALUES (?,?,?,?)`).run(
        'sample-connectivity', 'Codex connectivity sample', 'system',
        'Reply exactly AI_NEWS_HUB_TASK_OK. Do not use tools, read files, or delegate.',
      );
    });
  }

  setAutomaticPublisher(callback:NonNullable<EngineOptions['onAutomaticPublish']>):void {this.options.onAutomaticPublish=callback;}
  healthy(): boolean { return !this.fatal; }
  busy():boolean{return this.active.size>0||this.queue.length>0;}
  configure(value:{concurrency:number;maxQueue:number;timeoutMs:number;model?:string}):void {
    if(this.busy())throw new HttpError(409,'settings_busy');
    Object.assign(this.options,value);
  }
  listTasks(): TaskRecord[] { return this.db.prepare('SELECT * FROM tasks WHERE deleted_at IS NULL ORDER BY created_at DESC,id').all().map(row=>this.task(String(row.id))); }
  task(id: string): TaskRecord {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id=?').get(id);
    if (!row) throw new HttpError(404, 'task_not_found');
    const result = row as unknown as TaskRecord;
    if (row.configuration_json) result.configuration = JSON.parse(String(row.configuration_json)) as TaskConfiguration;
    delete (result as unknown as Record<string,unknown>).configuration_json;
    return result;
  }
  createTask(value: unknown): TaskRecord {
    const input=taskInput(value),id=randomUUID();
    this.db.prepare('INSERT INTO tasks(id,name,channel,prompt,status,configuration_json,next_run_at,timezone) VALUES (?,?,?,?,?,?,?,?)').run(id,input.name,'opensource',input.configuration.prompts[0]!,input.status,JSON.stringify(input.configuration),input.status==='active'?nextOccurrence(input.configuration,new Date()):null,input.configuration.timezone);
    return this.task(id);
  }
  updateTask(id:string,value:unknown):TaskRecord {
    const prior=this.task(id);if(!prior.configuration||prior.deleted_at)throw new HttpError(409,'task_not_editable');
    this.capacityForMutation(id);const input=taskInput(value);
    this.db.prepare('UPDATE tasks SET name=?,prompt=?,status=?,configuration_json=?,next_run_at=?,timezone=?,updated_at=? WHERE id=?').run(input.name,input.configuration.prompts[0]!,input.status,JSON.stringify(input.configuration),input.status==='active'?nextOccurrence(input.configuration,new Date()):null,input.configuration.timezone,now(),id);
    return this.task(id);
  }
  deleteTask(id:string):void {
    const prior=this.task(id);if(!prior.configuration)throw new HttpError(409,'task_not_editable');this.capacityForMutation(id);
    this.db.prepare("UPDATE tasks SET deleted_at=?,status='paused',next_run_at=NULL,updated_at=? WHERE id=?").run(now(),now(),id);
  }
  stopTask(id:string):void {
    this.task(id);for(const runId of this.active.keys())if(this.run(runId).task_id===id)this.cancel(runId);for(const row of this.db.prepare(`SELECT id FROM task_runs WHERE task_id=? AND status IN ${ACTIVE}`).all(id))this.cancel(String(row.id));
  }
  private capacityForMutation(id:string):void {
    if(this.db.prepare(`SELECT id FROM task_runs WHERE task_id=? AND status IN ${ACTIVE}`).get(id)||[...this.active.keys()].some(runId=>this.run(runId).task_id===id))throw new HttpError(409,'task_busy');
  }
  resetSchedules():void {
    for(const task of this.listTasks())if(task.configuration)this.db.prepare('UPDATE tasks SET next_run_at=? WHERE id=?').run(task.status==='active'?nextOccurrence(task.configuration,new Date()):null,task.id);
  }
  tick(at=new Date()):void {
    if(this.stopping||this.fatal)return;
    for(const row of this.db.prepare("SELECT id,next_run_at FROM tasks WHERE status='active' AND deleted_at IS NULL AND next_run_at IS NOT NULL AND next_run_at<=? ORDER BY next_run_at,id").all(at.toISOString())){
      const task=this.task(String(row.id));if(!task.configuration)continue;
      this.db.prepare('UPDATE tasks SET next_run_at=? WHERE id=?').run(nextOccurrence(task.configuration,at),task.id);
      try {this.start(task.id,'scheduled:'+String(row.next_run_at),{},'scheduled');}catch(error){if(!(error instanceof HttpError))throw error;}
    }
  }
  listAllRuns(query:RunListQuery):RunListResponse {return listRunSummaries(this.db,query,id=>this.run(id));}
  listRuns(taskId: string, limit = 20, offset = 0): RunRecord[] {
    this.task(taskId);
    return this.db.prepare('SELECT id FROM task_runs WHERE task_id=? ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?').all(taskId, limit, offset).map(row=>this.run(String(row.id)));
  }
  detail(runId: string): { run: RunRecord; turns: TurnRecord[]; sourceFailures?: import('../news/sources.js').SourceFailureDiagnostic[] } {
    const failure=this.db.prepare("SELECT data_json FROM run_events WHERE run_id=? AND kind='source_validation_failed' ORDER BY id DESC LIMIT 1").get(runId);
    return { run: this.run(runId), turns: this.db.prepare('SELECT * FROM run_turns WHERE run_id=? ORDER BY sequence').all(runId) as unknown as TurnRecord[], ...(failure?{sourceFailures:JSON.parse(String(failure.data_json)).failures}:{}) };
  }
  events(runId: string, after = 0, limit = 100): RunEvent[] {
    this.run(runId);
    return this.db.prepare('SELECT * FROM run_events WHERE run_id=? AND id>? ORDER BY id LIMIT ?').all(runId, after, limit).map((row) => ({
      id: Number(row.id), run_id: String(row.run_id), turn_record_id: row.turn_record_id as string | null,
      kind: String(row.kind), data: JSON.parse(String(row.data_json)) as Record<string, unknown>, created_at: String(row.created_at),
    }));
  }

  start(taskId: string, idempotencyKey: string, request: { topic?: string; input?: string } = {}, triggerKind: 'manual'|'scheduled' = 'manual'): { run: RunRecord; reused: boolean } {
    this.available(); key(idempotencyKey);
    const task = this.task(taskId);
    const managed=task.configuration;
    if(task.deleted_at)throw new HttpError(404,'task_not_found');
    if(managed) request={topic:managed.topic,input:managed.prompts[0]};
    const research = taskId === NEWS_TASK_ID || !!managed;
    if (research) {
      if (typeof request.topic !== 'string' || !request.topic.trim() || request.topic.length > 200) throw new HttpError(400, 'invalid_topic');
      inputText(request.input!);
    } else if (request.topic !== undefined || request.input !== undefined) throw new HttpError(400, 'unsupported_run_input');
    const input = research ? request.input! : task.prompt;
    const existing = this.db.prepare('SELECT * FROM task_runs WHERE task_id=? AND idempotency_key=?').get(taskId, idempotencyKey);
    if (existing) {
      if (research) {
        const prior = this.db.prepare('SELECT topic,initial_input FROM codex_news_runs WHERE run_id=?').get(existing.id);
        if (!prior || prior.topic !== request.topic || prior.initial_input !== input) throw new HttpError(409, 'idempotency_conflict');
      }
      return { run: existing as unknown as RunRecord, reused: true };
    }
    if (task.status !== 'active' && (!managed || triggerKind === 'scheduled')) throw new HttpError(409, 'task_paused');
    inputText(input); this.capacity(taskId);
    const runId = randomUUID(), turnId = randomUUID();
    this.transaction(() => {
      this.db.prepare('INSERT INTO task_runs(id,task_id,idempotency_key,configuration_json,trigger_kind) VALUES (?,?,?,?,?)').run(runId, taskId, idempotencyKey,managed?JSON.stringify(managed):null,triggerKind);
      this.db.prepare('INSERT INTO run_turns(id,run_id,sequence,idempotency_key,input_text,mode) VALUES (?,?,1,?,?,?)').run(turnId, runId, idempotencyKey, input, managed?.prompts.length===1 ? 'finalize' : research ? 'research' : 'default');
      if (research) this.db.prepare('INSERT INTO codex_news_runs(run_id,topic,initial_input,report_date,channel) VALUES (?,?,?,?,?)').run(runId, request.topic!, input, now().slice(0,10), task.channel);
      this.event(runId, turnId, 'queued', {});
    });
    this.queue.push({ runId, turnId, input }); this.schedule();
    return { run: this.run(runId), reused: false };
  }

  continueRun(runId: string, idempotencyKey: string, input: string, finalize = false): { run: RunRecord; turn: TurnRecord; reused: boolean } {
    this.available(); key(idempotencyKey); inputText(input);
    const run = this.run(runId);
    if(this.runConfiguration(runId))throw new HttpError(409,'managed_run_automatic');
    const research = run.task_id === NEWS_TASK_ID;
    if (!research && (finalize || run.task_id === 'news-github' || this.options.workflows?.has(run.task_id))) throw new HttpError(409, 'workflow_continuation_disabled');
    const mode = research ? finalize ? 'finalize' : 'research' : 'default';
    const prior = this.db.prepare('SELECT * FROM run_turns WHERE run_id=? AND idempotency_key=?').get(runId, idempotencyKey) as unknown as TurnRecord | undefined;
    if (prior) {
      if (prior.input_text !== input || prior.mode !== mode) throw new HttpError(409, 'idempotency_conflict');
      return { run, turn: prior, reused: true };
    }
    if (research && this.db.prepare('SELECT report_id FROM codex_news_runs WHERE run_id=?').get(runId)?.report_id) throw new HttpError(409, 'workflow_run_finalized');
    if (!run.thread_id) throw new HttpError(409, 'thread_unavailable');
    if (this.task(run.task_id).status !== 'active') throw new HttpError(409, 'task_paused');
    this.capacity(run.task_id);
    const sequence = Number(this.db.prepare('SELECT max(sequence) n FROM run_turns WHERE run_id=?').get(runId)?.n ?? 0) + 1;
    if (sequence > 20) throw new HttpError(409, 'turn_limit');
    const turnId = randomUUID();
    this.transaction(() => {
      this.db.prepare('INSERT INTO run_turns(id,run_id,sequence,idempotency_key,input_text,mode) VALUES (?,?,?,?,?,?)').run(turnId, runId, sequence, idempotencyKey, input, mode);
      this.db.prepare("UPDATE task_runs SET status='queued',turn_id=NULL,finished_at=NULL,error_code=NULL,error_message=NULL,updated_at=? WHERE id=?").run(now(), runId);
      this.event(runId, turnId, 'queued', { continuation: true });
    });
    this.queue.push({ runId, turnId, input, threadId: run.thread_id }); this.schedule();
    return { run: this.run(runId), turn: this.turn(turnId), reused: false };
  }

  cancel(runId: string): RunRecord {
    const run = this.run(runId);
    const queued = this.queue.find((work) => work.runId === runId);
    if (queued) {
      this.queue = this.queue.filter((work) => work !== queued);
      this.finish(queued, 'cancelled', 'cancelled');
    } else {
      const slot = this.active.get(runId);
      if (slot && !slot.reason) {
        slot.reason = 'cancelled';
        this.event(runId, null, 'cancellation_requested', {});
        slot.controller.abort();
      }
    }
    return this.run(run.id);
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.stopping = true;
    for (const work of this.queue) this.finish(work, 'interrupted', 'backend_stopped');
    this.queue = [];
    for (const slot of this.active.values()) { slot.reason ??= 'backend_stopped'; slot.controller.abort(); }
    this.closing = Promise.all([...this.active.values()].map((slot) => slot.done)).then(() => {});
    return this.closing;
  }

  private available(): void {
    if (this.stopping || this.fatal) throw new HttpError(503, 'engine_unavailable');
  }
  private failEngine(): void {
    if (this.fatal) return;
    this.fatal = true;
    this.options.onFatal?.();
  }
  private capacity(taskId: string): void {
    if ([...this.active.keys()].some(id=>this.run(id).task_id===taskId) || this.db.prepare(`SELECT id FROM task_runs WHERE task_id=? AND status IN ${ACTIVE} LIMIT 1`).get(taskId)) throw new HttpError(409, 'task_busy');
    if (this.active.size + this.queue.length >= this.options.concurrency + this.options.maxQueue) throw new HttpError(429, 'queue_full');
  }
  private runConfiguration(id:string):TaskConfiguration|undefined {
    const value=this.db.prepare('SELECT configuration_json FROM task_runs WHERE id=?').get(id)?.configuration_json;
    return value?JSON.parse(String(value)) as TaskConfiguration:undefined;
  }
  private run(id: string): RunRecord {
    const row = this.db.prepare('SELECT * FROM task_runs WHERE id=?').get(id);
    if (!row) throw new HttpError(404, 'run_not_found');
    const result=row as unknown as RunRecord;
    const snapshot=this.runConfiguration(id);
    if(snapshot)result.configuration=snapshot;
    delete (result as unknown as Record<string,unknown>).configuration_json;
    result.publishing=this.active.has(id)&&result.status==='succeeded';
    return result;
  }
  private turn(id: string): TurnRecord { return this.db.prepare('SELECT * FROM run_turns WHERE id=?').get(id) as unknown as TurnRecord; }
  private transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  private event(runId: string, turnId: string | null, kind: string, data: object): void {
    this.db.prepare('INSERT INTO run_events(run_id,turn_record_id,kind,data_json) VALUES (?,?,?,?)').run(runId, turnId, kind, JSON.stringify(data));
  }
  private schedule(): void { queueMicrotask(() => this.drain()); }
  private drain(): void {
    while (!this.stopping && !this.fatal && this.active.size < this.options.concurrency && this.queue.length) {
      const work = this.queue.shift()!;
      const slot: Slot = { controller: new AbortController(), done: Promise.resolve() };
      this.active.set(work.runId, slot);
      slot.done = this.execute(work, slot).catch(() => this.failEngine()).finally(() => {
        this.active.delete(work.runId); try {this.advance(work);} catch {this.failEngine();} this.schedule();
      });
    }
  }
  private advance(work:Work):void {
    const config=this.runConfiguration(work.runId),run=this.run(work.runId);
    if(!config||this.stopping||this.fatal)return;
    if(run.status!=='succeeded')return;
    const sequence=this.turn(work.turnId).sequence;
    if(sequence>=config.prompts.length)return;
    const input=config.prompts[sequence]!,turnId=randomUUID(),mode=sequence+1===config.prompts.length?'finalize':'research';
    this.transaction(()=>{
      this.db.prepare('INSERT INTO run_turns(id,run_id,sequence,idempotency_key,input_text,mode) VALUES (?,?,?,?,?,?)').run(turnId,run.id,sequence+1,'automatic:'+String(sequence+1),input,mode);
      this.db.prepare("UPDATE task_runs SET status='queued',finished_at=NULL,turn_id=NULL,updated_at=? WHERE id=?").run(now(),run.id);
      this.event(run.id,turnId,'queued',{automatic:true});
    });
    this.queue.push({runId:run.id,turnId,input,threadId:run.thread_id!});
  }
  private finish(work: Work, status: RunStatus, code?: string, output?: string, save?: () => void): void {
    this.transaction(() => {
      save?.();
      this.db.prepare('UPDATE task_runs SET status=?,error_code=?,finished_at=?,updated_at=? WHERE id=?').run(status, code ?? null, now(), now(), work.runId);
      this.db.prepare('UPDATE run_turns SET status=?,error_code=?,output_text=?,finished_at=? WHERE id=?').run(status, code ?? null, output ?? null, now(), work.turnId);
      this.event(work.runId, work.turnId, 'finished', { status, ...(code ? { code } : {}) });
    });
  }
  private async execute(work: Work, slot: Slot): Promise<void> {
    let events = 0, eventBytes = 0;
    let settled = false;
    let proposedOutput:string|undefined;
    const timer = setTimeout(() => { slot.reason ??= 'timeout'; slot.controller.abort(); }, this.options.timeoutMs);
    try {
      this.transaction(() => {
        this.db.prepare("UPDATE task_runs SET status='running',started_at=coalesce(started_at,?),updated_at=? WHERE id=?").run(now(), now(), work.runId);
        this.db.prepare("UPDATE run_turns SET status='running',started_at=? WHERE id=?").run(now(), work.turnId);
        this.event(work.runId, work.turnId, 'started', {});
      });
      const run = this.run(work.runId);
      const configuration=this.runConfiguration(run.id);
      const workflow = this.options.workflows?.get(configuration?NEWS_TASK_ID:run.task_id);
      const prepared = workflow ? await workflow.prepare(run, slot.controller.signal, { input: work.input, mode: this.turn(work.turnId).mode }) : { input: work.input };
      if (slot.reason) throw new AgentError('cancelled');
      if (prepared.metadata) this.event(work.runId, work.turnId, 'input_prepared', prepared.metadata);
      const result = await this.options.adapter.execute({
        runId: work.runId, threadId: work.threadId, input: prepared.input, cwd: this.options.cwd,
        model: this.options.model, timeoutMs: this.options.timeoutMs, signal: slot.controller.signal,
        outputSchema: prepared.outputSchema, developerInstructions: prepared.developerInstructions, forbidTools: prepared.forbidTools,
        webSearch: prepared.webSearch,
      }, (event) => {
        if (slot.reason || settled) return;
        eventBytes += Buffer.byteLength(JSON.stringify(event));
        if (++events > 200 || eventBytes > 128 * 1024) throw new AgentError('event_limit');
        this.persist(work, event);
      });
      if (slot.reason) throw new AgentError('cancelled');
      const saved = this.turn(work.turnId);
      if (result.status !== 'completed') throw new AgentError(result.status === 'interrupted' ? 'interrupted' : 'agent_failed');
      if (!validId(saved.thread_id ?? '') || !validId(saved.server_turn_id ?? '') || result.threadId !== saved.thread_id || result.turnId !== saved.server_turn_id) throw new AgentError('protocol_error');
      if (!result.output.trim()) throw new AgentError('invalid_output');
      if (Buffer.byteLength(result.output) > 64 * 1024) throw new AgentError('output_too_large');
      proposedOutput=result.output;
      const commit = await prepared.complete?.(result.output, slot.controller.signal);
      if (slot.reason) throw new AgentError('cancelled');
      this.finish(work, 'succeeded', undefined, result.output, commit ? () => commit(this.db) : prepared.save ? () => prepared.save!(this.db, result.output) : undefined);
      if(configuration?.autoPublish && this.turn(work.turnId).mode==='finalize'){
        const reportId=this.db.prepare('SELECT report_id FROM codex_news_runs WHERE run_id=?').get(run.id)?.report_id;
        if(!reportId)throw new AppError('report_not_found');
        this.event(run.id,work.turnId,'automatic_publication_started',{});
        try {
          if(!this.options.onAutomaticPublish)throw new AppError('publication_disabled');
          await this.options.onAutomaticPublish(String(reportId),slot.controller.signal);
          this.event(run.id,work.turnId,'automatic_publication_succeeded',{});
        } catch(error) {
          const code=error instanceof AppError?error.code:'github_unavailable';
          this.db.prepare('UPDATE task_runs SET error_code=?,updated_at=? WHERE id=?').run(code,now(),run.id);
          this.event(run.id,work.turnId,'automatic_publication_failed',{code});
        }
      }
    } catch (error) {
      // Unreaped processes can still hold a Thread or consume quota. A timeout
      // or cancellation must not hide this loss of lifecycle control.
      if (error instanceof AgentError && error.code === 'cleanup_failed') {
        this.finish(work, 'failed', 'cleanup_failed');
        this.failEngine();
        return;
      }
      const code = slot.reason ?? (error instanceof AgentError || error instanceof AppError ? error.code : 'event_persistence_failed');
      const status = code === 'cancelled' ? 'cancelled' : code === 'interrupted' || code === 'backend_stopped' ? 'interrupted' : 'failed';
      this.finish(work, status, code, proposedOutput);
    } finally { settled = true; clearTimeout(timer); }
  }
  private persist(work: Work, event: AgentEvent): void {
    this.transaction(() => {
      if (event.type === 'thread') {
        if (!validId(event.threadId)) throw new AgentError('protocol_error');
        const run = this.run(work.runId);
        if (run.thread_id && run.thread_id !== event.threadId) throw new AgentError('protocol_error');
        this.db.prepare('INSERT OR IGNORE INTO run_threads(run_id,thread_id) VALUES (?,?)').run(work.runId, event.threadId);
        const owner = this.db.prepare('SELECT run_id FROM run_threads WHERE thread_id=?').get(event.threadId);
        if (owner?.run_id !== work.runId) throw new AgentError('protocol_error');
        this.db.prepare('UPDATE task_runs SET thread_id=?,updated_at=? WHERE id=?').run(event.threadId, now(), work.runId);
        this.db.prepare('UPDATE run_turns SET thread_id=? WHERE id=?').run(event.threadId, work.turnId);
      } else if (event.type === 'turn') {
        if (!validId(event.turnId) || event.threadId !== this.run(work.runId).thread_id) throw new AgentError('protocol_error');
        this.db.prepare('UPDATE run_turns SET server_turn_id=? WHERE id=?').run(event.turnId, work.turnId);
        this.db.prepare('UPDATE task_runs SET turn_id=?,updated_at=? WHERE id=?').run(event.turnId, now(), work.runId);
      } else if (event.type === 'approval_required') {
        this.db.prepare("UPDATE task_runs SET status='waiting_approval',updated_at=? WHERE id=?").run(now(), work.runId);
        this.db.prepare("UPDATE run_turns SET status='waiting_approval' WHERE id=?").run(work.turnId);
      }
      this.event(work.runId, work.turnId, event.type, event);
    });
  }
}
