const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
function harness(){
 const record={_id:"notice",recipient:"buyer",type:"EVENT_CANCELLED",title:"Cancelled",message:"Event cancelled",attempts:0};
 const notices=new Map();let emailCalls=0,failEmail=true;
 const dependencies={
  crypto:require("crypto"),
  "../models/client/notificationOutbox.schema":{
   findOneAndUpdate:async(filter,update)=>{if(record.completedAt || record.failedAt || record.nextAttemptAt>Date.now())return null;Object.assign(record,update.$set);record.attempts++;return {...record};},
   updateOne:async(filter,update)=>{assert.equal(filter.lockToken,record.lockToken);Object.assign(record,update.$set);},
  },
  "../models/client/notification.schema":{updateOne:async(filter,update)=>{if(!notices.has(filter._id))notices.set(filter._id,update.$setOnInsert);}},
  "../models/client/user.schema":{findById:()=>({select(){return this;},lean:async()=>({firstName:"Buyer",email:"buyer@example.test"})})},
  "./email.service":{sendEmail:async args=>{emailCalls++;assert.equal(args.idempotencyKey,"refund-notice/notice");if(failEmail)throw Error("Provider unavailable");return {id:"accepted"};}},
  "./notification/emailTemplates":{generalNotificationTemplate:()=>"test"},
  "../constants/notificationTypes":require("../constants/notificationTypes"),
 };
 const context={module:{exports:{}},require:name=>{assert.ok(name in dependencies,name);return dependencies[name];},console:{error(){}},setTimeout};
 vm.runInNewContext(fs.readFileSync(require.resolve("../services/refundNotifications.service"),"utf8"),context);
 return {record,notices,get emailCalls(){return emailCalls;},recover(){failEmail=false;record.nextAttemptAt=new Date(0);},run:()=>context.module.exports.processRefundNotices({limit:1,delayMs:0})};
}
test("failed email remains queued, retries without duplicate in-app notification, and stops on success",async()=>{
 const f=harness();await f.run();assert.equal(f.notices.size,1);assert.equal(f.emailCalls,1);assert.ok(f.record.inAppSentAt);assert.equal(f.record.completedAt,undefined);assert.match(f.record.lastError,/Provider unavailable/);
 await f.run();assert.equal(f.emailCalls,1);
 f.recover();await f.run();assert.equal(f.notices.size,1);assert.equal(f.emailCalls,2);assert.ok(f.record.emailSentAt);assert.ok(f.record.completedAt);
 await f.run();assert.equal(f.emailCalls,2);
});
const {ticketPriceMinor}=require("../services/eventRefundAmount.service");
test("legacy checkout totals preserve ticket-only refunds and reject corrupt totals",()=>{
 assert.equal(ticketPriceMinor({totalAmount:1100,items:[{subtotalAmount:1000,totalPrice:1100}]}),1000);
 assert.equal(ticketPriceMinor({totalAmount:1000,items:[{pricePerUnit:500,quantity:2}]}),1000);
 for(const subtotalAmount of [-1,1.5,1200])assert.throws(()=>ticketPriceMinor({subtotalAmount,totalAmount:1100}),/invalid/);
});

test("twelve failed deliveries leave the retry queue for manual attention",async()=>{
 const f=harness();f.record.attempts=11;await f.run();assert.ok(f.record.failedAt);assert.equal(f.record.completedAt,undefined);
 f.record.nextAttemptAt=new Date(0);await f.run();assert.equal(f.emailCalls,1);assert.equal(f.notices.size,1);
});
