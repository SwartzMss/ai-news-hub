import {afterEach,expect,test,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {Login} from './Login';
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
test('first visit requires local setup code and matching password and receives a session',async()=>{
 const fetcher=vi.fn(async(_url,init)=>init?.method==='POST'?Response.json({token:'session-from-server'},{status:201}):Response.json({initialized:false,mode:'setup'}));vi.stubGlobal('fetch',fetcher);
 const connected=vi.fn();render(<Login onConnected={connected}/>);
 fireEvent.change(await screen.findByLabelText('初始化码'),{target:{value:'local-code'}});fireEvent.change(screen.getByLabelText('管理员密码'),{target:{value:'test-password-123'}});fireEvent.change(screen.getByLabelText('确认密码'),{target:{value:'test-password-123'}});
 fireEvent.click(screen.getByRole('button',{name:'初始化并进入后台'}));await waitFor(()=>expect(connected).toHaveBeenCalledWith('session-from-server'));
 const post=fetcher.mock.calls.find(([,init])=>init?.method==='POST')!;expect(post[0]).toBe('/api/auth/setup');expect(JSON.parse(post[1].body)).toEqual({code:'local-code',password:'test-password-123'});
});
