const {test}=require("node:test");const assert=require("node:assert/strict");
const {allocateTicketRefunds:allocate}=require("../services/ticketRefundAllocation.service");
test("ticket refunds conserve line totals across different prices and rounding",()=>{
 const booking={_id:"order",buyer:"giver",subtotalAmount:501,totalAmount:550,items:[{ticketId:"vip",quantity:2,subtotalAmount:301},{ticketId:"standard",quantity:1,subtotalAmount:200}]};
 const tickets=[{_id:"a",bookingId:"order",ticketTypeId:"vip",owner:"one"},{_id:"b",bookingId:"order",ticketTypeId:"vip",owner:"two"},{_id:"c",bookingId:"order",ticketTypeId:"standard",owner:"one"}];
 const rows=allocate(booking,tickets,{_id:"event",createdBy:"host"},new Date());assert.deepEqual(rows.map(row=>row.amountMinor),[151,150,200]);assert.deepEqual(rows.map(row=>row.buyer),["one","two","one"]);
 assert.throws(()=>allocate(booking,tickets.slice(1),{_id:"event"},new Date()),/incomplete/);
});
