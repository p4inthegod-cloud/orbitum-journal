import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {makeJournalHandler} from '../api/journal-tg.js';

test('the journal routes retain isolated handlers after deployment rewrites',()=>{
 const calls=[],handler=makeJournalHandler({okxHandler:()=>calls.push('okx'),telegramHandler:()=>calls.push('telegram')});
 handler({url:'/api/journal-tg',query:{__journal_service:'okx'}},{});
 handler({url:'/api/journal-tg?__journal_service=okx'},{});
 handler({url:'/api/okx'},{});
 handler({url:'/api/journal-tg',body:{action:'notify'}},{});
 handler({url:'/api/journal-tg?__journal_service=unknown'},{});
 assert.deepEqual(calls,['okx','okx','okx','telegram','telegram']);
});

test('the deployed OKX route uses the shared function within the hosting limit',()=>{
 const config=JSON.parse(fs.readFileSync(new URL('../vercel.json',import.meta.url)));
 const files=fs.readdirSync(new URL('../api/',import.meta.url)).filter(f=>f.endsWith('.js'));
 assert.ok(files.length<=12);assert.ok(!files.includes('okx.js'));
 assert.equal(config.rewrites.find(r=>r.source==='/api/okx').destination,'/api/journal-tg?__journal_service=okx');
 assert.ok(config.functions['api/journal-tg.js'].maxDuration>=60);
});
