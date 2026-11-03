import { constants, closeSync, fstatSync, openSync, readSync, writeFileSync } from 'node:fs';
import { AppError } from '../errors.js';

export function privateFile(path:string, create:()=>string, required=false): string {
  let fd: number;
  try { fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW); }
  catch(error) {
    if (!(error instanceof Error && 'code' in error && error.code==='ENOENT')) throw new AppError('unsafe_settings_file');
    if(required)throw new AppError('settings_key_missing');
    fd=openSync(path,constants.O_CREAT|constants.O_EXCL|constants.O_RDWR|constants.O_NOFOLLOW,0o600);
    try {writeFileSync(fd,create(),'utf8');} catch(error){closeSync(fd);throw error;}
  }
  try {
    const file=fstatSync(fd);
    if(!file.isFile() || file.uid!==process.getuid?.() || (file.mode&0o077)!==0 || file.size>4096)throw new AppError('unsafe_settings_file');
    const value=Buffer.alloc(file.size);readSync(fd,value,0,value.length,0);return value.toString('utf8').trim();
  } finally {closeSync(fd);}
}
