import {afterEach,expect,test,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {Settings} from './Settings';
afterEach(cleanup);
const value={revision:1,logLevel:'info',codex:{binary:'codex',model:''},execution:{timeoutMs:120000,concurrency:1,maxQueue:20},github:{enabled:false,repository:'',branch:'',tokenConfigured:true}};
test('settings submit explicit target and omit blank token to preserve the saved secret',async()=>{
 const api=vi.fn().mockImplementation(async(_url,_signal,body)=>body?{...value,...body,revision:2,github:{...body.github,tokenConfigured:true}}:value);
 render(<Settings api={api} onCredentialChanged={()=>{}}/>);
 const repository=await screen.findByLabelText('GitHub 仓库');
 expect((screen.getByLabelText('GitHub Token') as HTMLInputElement).value).toBe('');
 expect(screen.getByText(/已配置；留空保留原 Token/)).toBeTruthy();
 fireEvent.click(screen.getByLabelText('启用 GitHub 归档'));fireEvent.change(repository,{target:{value:'owner/archive'}});fireEvent.change(screen.getByLabelText('GitHub 分支'),{target:{value:'reports'}});
 fireEvent.click(screen.getByRole('button',{name:'保存设置'}));await screen.findByText('设置已保存并生效。');
 const sent=api.mock.calls.find(call=>call[2])![2];expect(sent.github).toEqual({enabled:true,repository:'owner/archive',branch:'reports'});expect(sent.revision).toBe(1);
 expect(api.mock.calls.filter(call=>call[2])).toHaveLength(1);
});
test('secret clearing is explicit and password rotation replaces the in-memory session',async()=>{
 const changed=vi.fn();const api=vi.fn().mockImplementation(async(url,_signal,body)=>url==='/auth/password'?{token:'new-session'}:body?{...value,revision:2,github:{...body.github,tokenConfigured:false}}:value);
 render(<Settings api={api} onCredentialChanged={changed}/>);
 await screen.findByLabelText('GitHub Token');fireEvent.click(screen.getByLabelText('清除已存 Token'));fireEvent.click(screen.getByRole('button',{name:'保存设置'}));await screen.findByText('设置已保存并生效。');
 expect(api.mock.calls.find(call=>call[2])![2].github.clearToken).toBe(true);
 fireEvent.change(screen.getByLabelText('当前密码或旧 Token'),{target:{value:'old-password'}});fireEvent.change(screen.getByLabelText('新管理员密码'),{target:{value:'new-password-1234'}});fireEvent.change(screen.getByLabelText('确认新密码'),{target:{value:'new-password-1234'}});
 fireEvent.click(screen.getByRole('button',{name:'更新管理员密码'}));await waitFor(()=>expect(changed).toHaveBeenCalledWith('new-session'));
});
