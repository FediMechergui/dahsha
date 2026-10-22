import { discoverLibrary } from '../server/src/library-service.js';
import { PRODUCT } from '../server/src/product.js';

export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  if(req.method==='OPTIONS')return res.status(200).end();
  // Dahsha browses its static catalogue: live discovery counted against Vercel's Hobby CPU limit (2026-10-21).
  if(PRODUCT!=='flixer'){res.setHeader('Cache-Control','public, s-maxage=86400');return res.status(404).json({error:'Browse the static catalogue'});}
  try{
    const data=await discoverLibrary({kind:req.query.kind||'film',page:req.query.page,genre:req.query.genre,year:req.query.year,latest:req.query.latest});
    res.setHeader('Cache-Control','public, s-maxage=120, stale-while-revalidate=300');
    return res.json(data);
  }catch(e){return res.status(502).json({error:e.message});}
}
