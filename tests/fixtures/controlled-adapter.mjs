import { AgentError } from '../../dist/apps/server/src/agent/types.js';

export class ControlledAdapter {
  calls = [];
  execute(input, emit) {
    return new Promise((resolve, reject) => {
      const call = { input, emit, resolve, reject };
      this.calls.push(call);
      input.signal.addEventListener('abort', () => reject(new AgentError('cancelled')), { once: true });
    });
  }
  succeed(index, output = 'fixture response') {
    const call = this.calls[index];
    const threadId = call.input.threadId ?? `thread-${index}`;
    const turnId = `turn-${index}`;
    try {
      call.emit({ type: 'thread', threadId });
      call.emit({ type: 'turn', threadId, turnId });
      call.emit({ type: 'message', text: output });
      call.resolve({ status: 'completed', threadId, turnId, output });
    } catch (error) { call.reject(error); }
  }
}
