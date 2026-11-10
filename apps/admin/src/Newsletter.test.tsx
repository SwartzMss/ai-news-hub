import {afterEach,expect,test,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {Newsletter} from './Newsletter';
import type {Client} from './api';

afterEach(()=>{cleanup();vi.restoreAllMocks();});

test('newsletter page has only time and schedule switch',async()=>{
  const state={schedule:{enabled:false,timezone:'Asia/Shanghai',time:'09:00',next_run_at:null},dispatches:[]};
  const api=vi.fn(async(path:string,_signal?:AbortSignal,body?:unknown)=>{if(path==='/newsletter')return state;if(path==='/newsletter/schedule'){Object.assign(state.schedule,body);return {schedule:state.schedule};}throw Error(path);}) as unknown as Client;
  render(<Newsletter api={api}/>);
  const toggle=await screen.findByRole('switch',{name:'每日发送'});
  expect(toggle.getAttribute('aria-checked')).toBe('false');
  expect(screen.getByLabelText('发送时间（北京时间）')).toBeTruthy();
  expect(screen.queryByText('执行记录')).toBeNull();
  expect(screen.queryByRole('button',{name:'立即触发'})).toBeNull();
  fireEvent.click(toggle);
  await waitFor(()=>expect(api).toHaveBeenCalledWith('/newsletter/schedule',expect.any(AbortSignal),{enabled:true,time:'09:00'},'PUT'));
  await waitFor(()=>expect(toggle.getAttribute('aria-checked')).toBe('true'));
});

test('changing the time saves on blur without a separate button',async()=>{
  const state={schedule:{enabled:true,timezone:'Asia/Shanghai',time:'09:00',next_run_at:null},dispatches:[]};
  const api=vi.fn(async(path:string,_signal?:AbortSignal,body?:unknown)=>{if(path==='/newsletter')return state;if(path==='/newsletter/schedule'){Object.assign(state.schedule,body);return {schedule:state.schedule};}throw Error(path);}) as unknown as Client;
  render(<Newsletter api={api}/>);
  const input=await screen.findByLabelText('发送时间（北京时间）');
  await waitFor(()=>expect(input).not.toHaveProperty('disabled',true));
  fireEvent.change(input,{target:{value:'10:30'}});
  fireEvent.blur(input);
  await waitFor(()=>expect(api).toHaveBeenCalledWith('/newsletter/schedule',expect.any(AbortSignal),{enabled:true,time:'10:30'},'PUT'));
  expect(screen.queryByRole('button',{name:'保存时间'})).toBeNull();
});

test('switch saves a pending time edit together with the new state',async()=>{
  const state={schedule:{enabled:false,timezone:'Asia/Shanghai',time:'09:00',next_run_at:null},dispatches:[]};
  const api=vi.fn(async(path:string,_signal?:AbortSignal,body?:unknown)=>{if(path==='/newsletter')return state;if(path==='/newsletter/schedule'){Object.assign(state.schedule,body);return {schedule:state.schedule};}throw Error(path);}) as unknown as Client;
  render(<Newsletter api={api}/>);
  const input=await screen.findByLabelText('发送时间（北京时间）');
  const toggle=screen.getByRole('switch',{name:'每日发送'});
  await waitFor(()=>expect(input).not.toHaveProperty('disabled',true));
  fireEvent.change(input,{target:{value:'11:15'}});
  fireEvent.blur(input,{relatedTarget:toggle});
  fireEvent.click(toggle);
  await waitFor(()=>expect(api).toHaveBeenCalledWith('/newsletter/schedule',expect.any(AbortSignal),{enabled:true,time:'11:15'},'PUT'));
  expect(vi.mocked(api).mock.calls.filter(([path])=>path==='/newsletter/schedule')).toHaveLength(1);
});
