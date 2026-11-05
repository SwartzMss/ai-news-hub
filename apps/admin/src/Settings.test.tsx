import {afterEach,expect,test,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {Settings} from './Settings';
afterEach(cleanup);
const value={revision:1,logLevel:'info',codex:{binary:'codex',model:''},execution:{timeoutMs:120000,concurrency:1,maxQueue:20},github:{enabled:false,repository:'',branch:'',tokenConfigured:true}};
test('settings submit explicit target and omit blank token to preserve the saved secret',async()=>{
 const api=vi.fn().mockImplementation(async(_url,_signal,body)=>body?{...value,...body,revision:2,github:{...body.github,tokenConfigured:true}}:value);
 render(<Settings api={api} onCredentialChanged={()=>{}}/>);
 await screen.findByLabelText('Codex 可执行文件');
 fireEvent.click(screen.getByRole('button',{name:'GitHub 归档'}));
 expect(screen.queryByLabelText('Codex 可执行文件')).toBeNull();
 expect(screen.queryByLabelText('当前密码或旧 Token')).toBeNull();
 expect(screen.queryByLabelText('GitHub Token')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'更换 Token'}));
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
 await screen.findByLabelText('Codex 可执行文件');fireEvent.click(screen.getByRole('button',{name:'GitHub 归档'}));fireEvent.click(screen.getByLabelText('清除已存 Token'));fireEvent.click(screen.getByRole('button',{name:'保存设置'}));await screen.findByText('设置已保存并生效。');
 expect(api.mock.calls.find(call=>call[2])![2].github.clearToken).toBe(true);
 fireEvent.click(screen.getByRole('button',{name:'安全设置'}));
 expect(screen.queryByRole('button',{name:'保存设置'})).toBeNull();
 fireEvent.change(screen.getByLabelText('当前密码或旧 Token'),{target:{value:'old-password'}});fireEvent.change(screen.getByLabelText('新管理员密码'),{target:{value:'new-password-1234'}});fireEvent.change(screen.getByLabelText('确认新密码'),{target:{value:'new-password-1234'}});
 fireEvent.click(screen.getByRole('button',{name:'更新管理员密码'}));await waitFor(()=>expect(changed).toHaveBeenCalledWith('new-session'));
});

test('unconfigured credentials stay absent until explicitly edited and branch starts blank',async()=>{
 const api=vi.fn().mockResolvedValue({...value,github:{...value.github,tokenConfigured:false}});
 render(<Settings api={api} onCredentialChanged={()=>{}}/>);
 await screen.findByLabelText('Codex 可执行文件');
 fireEvent.click(screen.getByRole('button',{name:'GitHub 归档'}));
 expect((screen.getByLabelText('GitHub 分支') as HTMLInputElement).value).toBe('');
 expect(screen.queryByLabelText('GitHub Token')).toBeNull();
 expect(screen.queryByLabelText('清除已存 Token')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'设置 Token'}));
 expect((screen.getByLabelText('GitHub Token') as HTMLInputElement).value).toBe('');
});

for(const timeoutMs of [600000,90000,1000])test(`timeout displays minutes and preserves existing ${timeoutMs}ms values`,async()=>{
 const initial={...value,execution:{...value.execution,timeoutMs}};
 const api=vi.fn().mockImplementation(async(_url,_signal,body)=>body?{...initial,...body,revision:2}:initial);
 render(<Settings api={api} onCredentialChanged={()=>{}}/>);
 const input=await screen.findByLabelText('每轮超时（分钟）');
 expect((input as HTMLInputElement).value).toBe(String(timeoutMs/60000));
 fireEvent.click(screen.getByRole('button',{name:'保存设置'}));
 await screen.findByText('设置已保存并生效。');
 expect(api.mock.calls.find(call=>call[2])![2].execution.timeoutMs).toBe(timeoutMs);
});
test('editing ten minutes submits six hundred thousand milliseconds',async()=>{
 const api=vi.fn().mockImplementation(async(_url,_signal,body)=>body?{...value,...body,revision:2}:value);
 render(<Settings api={api} onCredentialChanged={()=>{}}/>);
 fireEvent.change(await screen.findByLabelText('每轮超时（分钟）'),{target:{value:'10'}});
 fireEvent.click(screen.getByRole('button',{name:'保存设置'}));await screen.findByText('设置已保存并生效。');
 expect(api.mock.calls.find(call=>call[2])![2].execution.timeoutMs).toBe(600000);
});
