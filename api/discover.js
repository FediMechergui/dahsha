import { discoverLibrary } from '../server/src/library-service.js';

export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  if(req.method==='OPTIONS')return res.status(200).end();
  try{
    const data=await discoverLibrary({kind:req.query.kind||'film',page:req.query.page,genre:req.query.genre,year:req.query.year});
    res.setHeader('Cache-Control','public, s-maxage=120, stale-while-revalidate=300');
    return res.json(data);
  }catch(e){return res.status(502).json({error:e.message});}
}
