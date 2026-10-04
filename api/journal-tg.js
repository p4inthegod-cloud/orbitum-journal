import okx from '../lib/okx-api.js';
import telegram from '../lib/journal-telegram.js';

// Preserve both public routes while staying within the hosting function limit.
export function makeJournalHandler({okxHandler=okx,telegramHandler=telegram}={}){
 return (req,res)=>{
  const url=new URL(req.url||'/api/journal-tg','https://www.orbitum.trade');
  const service=req.query?.__journal_service||url.searchParams.get('__journal_service');
  return service==='okx'||url.pathname==='/api/okx'?okxHandler(req,res):telegramHandler(req,res);
 };
}
export default makeJournalHandler();
