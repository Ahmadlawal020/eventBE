const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const express=require("express");
const request=require("supertest");
function app(){
 const noop=(_req,res)=>res.json({success:true});
 const dependencies={express,"express-rate-limit":require("express-rate-limit"),
  "../../controllers/client/refundSettlement.controller":{prepare:noop},
  "../../controllers/client/refundSupport.controller":{requestSupport:noop},mongoose:require("mongoose"),
  "../../middleware/verifyJWT":(req,res,next)=>req.headers.authorization === "Bearer test" ? (req.user={id:"test-user"},next()) : res.sendStatus(401),
  "../../controllers/client/eventRefund.controller":new Proxy({}, {get:()=>noop}),
  "../../controllers/client/eventRefundReceipt.controller":{prepareReceiptUpload:noop,completeReceiptUpload:noop,getReceipt:noop,uploadReceipt:(req,res)=>res.json({success:true,body:req.body})},
 };
 const context={module:{exports:{}},console,require:name=>{assert.ok(name in dependencies,name);return dependencies[name];}};
 vm.runInNewContext(fs.readFileSync(require.resolve("../routes/client/eventRefund.route"),"utf8"),context);
 const app=express();app.use(express.json());app.use("/api/event-refunds",context.module.exports);return app;
}
const url="/api/event-refunds/507f1f77bcf86cd799439011/receipt";
test("receipt base64 survives the HTTP parser above the default JSON size limit",async()=>{
 const body=Buffer.alloc(256*1024,120).toString("base64");
 const res=await request(app()).post(url).set("Authorization","Bearer test").type("text/plain").send(body);
 assert.equal(res.status,200);assert.equal(res.body.body,body);
});
test("unauthenticated receipt upload is rejected",async()=>{assert.equal((await request(app()).post(url).type("text/plain").send("abcd")).status,401);});
test("wrong content type and oversized receipt get actionable JSON errors",async()=>{
 const wrong=await request(app()).post(url).set("Authorization","Bearer test").send({image:"abcd"});assert.equal(wrong.status,415);
 const large=await request(app()).post(url).set("Authorization","Bearer test").type("text/plain").send("a".repeat(7*1024*1024+1));assert.equal(large.status,413);assert.match(large.body.message,/under 5 MB/);
});

test("receipt writes are rate limited per authenticated user",async()=>{
 const instance=app();for(let i=0;i<10;i++)assert.equal((await request(instance).post(url+"/prepare").set("Authorization","Bearer test").send({})).status,200);
 assert.equal((await request(instance).post(url+"/prepare").set("Authorization","Bearer test").send({})).status,429);
 assert.equal((await request(instance).get(url).set("Authorization","Bearer test")).status,200);
});
