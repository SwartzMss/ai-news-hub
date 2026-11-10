import {afterEach,expect,test,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {Newsletter} from './Newsletter';
import type {Client} from './api';

afterEach(()=>{cleanup();vi.restoreAllMocks();});
test('newsletter page shows schedule, safe run link and manual controls',async()=>{
  const state={schedule:{enabled:false,timezone:'Asia/Shanghai',time:'09:00',next_run_at:null},dispatches:[{dispatch_id:'newsletter-20261110-0900',trigger_reason:'scheduled',scheduled_at:'2026-11-10T01:00:00Z',status:'succeeded',attempt:0,workflow_run_id:42,html_url:'https://github.com/SwartzMss/ai-news-hub/actions/runs/42',error_code:null,finished_at:'2026-11-10T01:04:00Z'}]};
  const api=vi.fn(async(path:string,_signal?:AbortSignal,body?:unknown)=>{if(path==='/newsletter')return state;if(path==='/newsletter/schedule'){state.schedule.enabled=(body as {enabled:boolean}).enabled;return {schedule:state.schedule};}if(path==='/newsletter/dispatch')return {dispatch:state.dispatches[0]};throw Error(path);}) as unknown as Client;
  vi.spyOn(window,'confirm').mockReturnValue(true);
  render(<Newsletter api={api}/>);
  await screen.findByText('每日计划');
  expect(screen.getByRole('link',{name:'#42 ↗'}).getAttribute('rel')).toContain('noopener');
  fireEvent.click(screen.getByRole('button',{name:'启用计划'}));
  await waitFor(()=>expect(api).toHaveBeenCalledWith('/newsletter/schedule',expect.any(AbortSignal),{enabled:true},'PUT'));
  fireEvent.click(screen.getByRole('button',{name:'立即触发'}));
  await waitFor(()=>expect(api).toHaveBeenCalledWith('/newsletter/dispatch',expect.any(AbortSignal),{}));
});
