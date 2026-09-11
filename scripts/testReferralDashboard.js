const fs = require("fs"), path = require("path"), os = require("os");
const { spawn } = require("child_process");
const assert = require("assert/strict");
const express = require("express");
const sleep = ms => new Promise(resolve => setTimeout(resolve,ms));
const chromePath = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const app = express();
app.use(require("helmet")());
app.use(express.json());
const users = [{_id:"aaaaaaaaaaaaaaaaaaaaaaaa",firstName:"Ada",surname:"Host",email:"ada@example.com"},
  {_id:"bbbbbbbbbbbbbbbbbbbbbbbb",firstName:"Bola",surname:"Partner",email:"bola@example.com"}];
const policies = [{key:"GLOBAL",scope:"GLOBAL",version:1,revisions:[{version:1,name:"All users",
  effectiveAt:new Date(0).toISOString(),commissionPercentage:5,status:"ACTIVE",duration:{value:90,unit:"DAYS"},entryWindow:{value:14,unit:"DAYS"},userIds:[],priority:0}]}];
const calls = [];
app.post("/api/admin/auth/refresh",(req,res)=>res.status(401).json({success:false,message:"Login required"}));
app.post("/api/admin/auth/login",(req,res)=>res.json({success:true,data:{accessToken:"ui-test-only",user:{roles:["finance_admin"]}}}));
app.get("/api/admin/referrals/policies",(req,res)=>res.json({success:true,data:policies}));
app.get("/api/admin/referrals/users",(req,res)=>res.json({success:true,data:users}));
app.put("/api/admin/referrals/policies/:key",(req,res)=>{
  calls.push({kind:"save",key:req.params.key,...req.body});
  let p=policies.find(p=>p.key===req.params.key);
  if(!p){p={key:req.params.key,scope:"USER",version:0,revisions:[]};policies.push(p);}
  assert.equal(req.body.expectedVersion,p.version);
  const previous=p.revisions.at(-1)||{userIds:[],status:"INHERIT"};
  const next={...previous,...req.body,version:++p.version,effectiveAt:new Date().toISOString()};
  if(req.body.action)next.status={START:"ACTIVE",PAUSE:"PAUSED",RESUME:"ACTIVE",END:"ENDED",INHERIT:"INHERIT"}[req.body.action];
  p.revisions.push(next);res.json({success:true,data:p});
});
app.post("/api/admin/referrals/groups",(req,res)=>{
  calls.push({kind:"group",...req.body});
  const p={key:"GROUP:cccccccccccccccccccccccc",scope:"GROUP",version:1,
    revisions:[{...req.body,version:1,status:"INHERIT",effectiveAt:new Date().toISOString()}]};
  policies.push(p);res.json({success:true,data:p});
});
app.post("/api/admin/referrals/adjustments/preview",(req,res)=>{
  calls.push({kind:"preview",...req.body});
  res.json({success:true,data:{id:"dddddddddddddddddddddddd",count:2,previousTotal:300,revisedTotal:600}});
});
app.post("/api/admin/referrals/adjustments/:id/apply",(req,res)=>{
  calls.push({kind:"apply",...req.body});res.json({success:true,data:{appliedCount:2,status:"COMPLETED"}});
});
app.use(express.static(path.join(__dirname,"../public")));
(async()=>{
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),"munasaba-referral-ui-"));
  const server=await new Promise(resolve=>{const s=app.listen(0,"127.0.0.1",()=>resolve(s));});
  const chrome=spawn(chromePath,["--headless","--disable-gpu","--no-first-run","--disable-background-networking",
    "--remote-debugging-port=0","--user-data-dir="+profile,"about:blank"],{windowsHide:true,stdio:"ignore"});
  let ws;
  try{
    const portFile=path.join(profile,"DevToolsActivePort");
    for(let i=0;i<100&&!fs.existsSync(portFile);i++)await sleep(100);
    const port=fs.readFileSync(portFile,"utf8").split("\n")[0];
    const version=await (await fetch("http://127.0.0.1:"+port+"/json/version")).json();
    ws=new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((resolve,reject)=>{ws.addEventListener("open",resolve,{once:true});ws.addEventListener("error",reject,{once:true});});
    let nextId=1;const pending=new Map();
    ws.addEventListener("message",event=>{const m=JSON.parse(event.data);if(pending.has(m.id)){const{resolve,reject}=pending.get(m.id);pending.delete(m.id);m.error?reject(new Error(m.error.message)):resolve(m.result);}});
    const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{
      const id=nextId++;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));
    });
    const target=await send("Target.createTarget",{url:"about:blank"});
    const {sessionId}=await send("Target.attachToTarget",{targetId:target.targetId,flatten:true});
    const evaluate=async expression=>{
      const r=await send("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true},sessionId);
      if(r.exceptionDetails)throw new Error(r.exceptionDetails.text+": "+r.exceptionDetails.exception?.description);
      return r.result.value;
    };
    const waitFor=async expression=>{
      for(let i=0;i<100;i++){if(await evaluate(expression))return;await sleep(100);}
      throw new Error("UI timed out: "+expression+"; "+await evaluate("document.body.innerText"));
    };
    await send("Emulation.setDeviceMetricsOverride",{width:1280,height:1000,deviceScaleFactor:1,mobile:false},sessionId);
    await send("Page.navigate",{url:"http://127.0.0.1:"+server.address().port+"/admin/referrals/"},sessionId);
    await waitFor("document.readyState === 'complete' && typeof api === 'function'");
    await evaluate("document.getElementById('email').value='admin@example.com';document.getElementById('password').value='test-only';document.getElementById('login').requestSubmit()");
    await waitFor("!document.getElementById('dashboard').hidden");
    await evaluate("document.getElementById('rate').value='9';document.getElementById('duration').value='2';document.getElementById('duration-unit').value='MONTHS';document.getElementById('entry-value').value='3';document.getElementById('entry-unit').value='WEEKS';document.getElementById('settings').requestSubmit()");
    await waitFor("document.getElementById('message').textContent.startsWith('Saved.')");
    assert.equal(calls[0].commissionPercentage,9);assert.deepEqual(calls[0].entryWindow,{value:3,unit:"WEEKS"});
    await evaluate("document.querySelector('[data-action=PAUSE]').click()");
    await waitFor("document.getElementById('policy-status').textContent.startsWith('PAUSED')");
    await evaluate("document.querySelector('[data-action=RESUME]').click()");
    await waitFor("document.getElementById('policy-status').textContent.startsWith('ACTIVE')");
    await evaluate("document.getElementById('new-group').click();document.getElementById('search-users').click()");
    await waitFor("document.querySelectorAll('#user-results button').length===2");
    await evaluate("document.querySelector('#user-results button').click();document.getElementById('policy-name').value='Partners';document.getElementById('priority').value='20';document.getElementById('rate').value='12';document.getElementById('settings').requestSubmit()");
    await waitFor("document.getElementById('policy-title').textContent==='Partners'");
    assert.deepEqual(calls.find(c=>c.kind==="group").userIds,[users[0]._id]);
    await evaluate("document.getElementById('new-user').click();document.getElementById('search-users').click()");
    await waitFor("document.querySelectorAll('#user-results button').length===2");
    await evaluate("document.querySelectorAll('#user-results button')[1].click();document.getElementById('rate').value='15';document.getElementById('duration').value='1';document.getElementById('settings').requestSubmit()");
    await waitFor("document.getElementById('policy-status').textContent.includes('version 1')&&document.getElementById('policy-title').textContent==='Bola Partner'");
    await evaluate("document.getElementById('past-rate').value='10';document.getElementById('past-reason').value='Approved correction';document.getElementById('preview-form').requestSubmit()");
    await waitFor("!document.getElementById('preview').hidden");
    assert.equal(await evaluate("document.getElementById('apply-past').disabled"),true);
    assert.equal(calls.some(c=>c.kind==="apply"),false);
    await evaluate("document.getElementById('confirm-past').click();document.getElementById('apply-past').click()");
    await waitFor("document.getElementById('message').textContent.includes('2 earnings adjusted')");
    assert.equal(calls.find(c=>c.kind==="apply").confirm,true);
    const desktop=await send("Page.captureScreenshot",{format:"png",captureBeyondViewport:true},sessionId);
    fs.writeFileSync(profile+"-desktop.png",Buffer.from(desktop.data,"base64"));
    await send("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:1,mobile:true},sessionId);
    assert.equal(await evaluate("document.documentElement.scrollWidth <= window.innerWidth"),true);
    const mobile=await send("Page.captureScreenshot",{format:"png",captureBeyondViewport:true},sessionId);
    fs.writeFileSync(profile+"-mobile.png",Buffer.from(mobile.data,"base64"));
    console.log(JSON.stringify({passed:["login","global settings","pause/resume","group selection","individual rate","preview confirmation","mobile layout"],desktop:profile+"-desktop.png",mobile:profile+"-mobile.png"}));
    await send("Browser.close");
  }finally{
    if(ws)ws.close();chrome.kill();await new Promise(resolve=>server.close(resolve));
    // Only the unique test profile can be removed; browser screenshots are outside it.
    const resolved=path.resolve(profile),root=path.resolve(os.tmpdir())+path.sep;
    if(resolved.startsWith(root)&&path.basename(resolved).startsWith("munasaba-referral-ui-")){
      await sleep(500);try{fs.rmSync(resolved,{recursive:true,force:true});}catch{}
    }
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
