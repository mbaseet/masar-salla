// Read credentials via hidden stdin only; never persist or print them.
if(process.stdin.isTTY)process.stdin.setRawMode(true);
process.stdin.setEncoding('utf8');process.stdin.resume();
console.log('Ready for maintenance check JSON on stdin (input is hidden).');
let input='';
process.stdin.on('data',async chunk=>{
 input+=chunk;
 if(!/[\r\n]/.test(input))return;
 process.stdin.pause();
 try {
  const {origin,token}=JSON.parse(input.trim());input='';
  const url=new URL('/api/maintenance/run',origin);
  if(url.protocol!=='https:'||!url.hostname.endsWith('.chatgpt.site'))throw new Error('Invalid Site origin');
  const res=await fetch(url,{method:'POST',headers:{'OAI-Sites-Authorization':`Bearer ${token}`,Authorization:`Bearer ${token}`},redirect:'error'});
  const data=await res.json();console.log(JSON.stringify({status:res.status,result:data}));process.exit(res.ok?0:1);
 }catch(error){console.error(error.message);process.exit(1);}
});
