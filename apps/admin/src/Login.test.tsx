import {afterEach,expect,test,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {Login} from './Login';
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
function mockSetup(){const fetcher=vi.fn(async(_url,init)=>init?.method==='POST'?Response.json({token:'session-from-server'},{status:201}):Response.json({initialized:false,mode:'setup',setupToken:'automatic-local-proof'}));vi.stubGlobal('fetch',fetcher);return fetcher;}
test('first visit shows only set/confirm password and submits initialization proof automatically',async()=>{
 const fetcher=mockSetup(),connected=vi.fn();render(<Login onConnected={connected}/>);
 fireEvent.change(await screen.findByLabelText('设置密码'),{target:{value:'test-password-123'}});
 fireEvent.change(screen.getByLabelText('确认密码'),{target:{value:'test-password-123'}});
 expect(screen.queryByLabelText('初始化码')).toBeNull();expect(document.querySelectorAll('input')).toHaveLength(2);
 fireEvent.click(screen.getByRole('button',{name:'初始化并进入后台'}));await waitFor(()=>expect(connected).toHaveBeenCalledWith('session-from-server'));
 const post=fetcher.mock.calls.find(([,init])=>init?.method==='POST')!;expect(post[0]).toBe('/api/auth/setup');expect(JSON.parse(post[1].body)).toEqual({setupToken:'automatic-local-proof',password:'test-password-123'});
});
test('password mismatch remains local and does not initialize the administrator',async()=>{
 const fetcher=mockSetup();render(<Login onConnected={()=>{}}/>);
 fireEvent.change(await screen.findByLabelText('设置密码'),{target:{value:'test-password-123'}});fireEvent.change(screen.getByLabelText('确认密码'),{target:{value:'different-password-456'}});
 fireEvent.click(screen.getByRole('button',{name:'初始化并进入后台'}));await screen.findByText('两次输入的密码不一致。');expect(fetcher.mock.calls.some(([,init])=>init?.method==='POST')).toBe(false);
});
