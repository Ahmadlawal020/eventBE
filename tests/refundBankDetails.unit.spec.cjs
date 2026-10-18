const {test}=require("node:test");
const assert=require("node:assert/strict");
const {normalizeRefundBankDetails:normalize}=require("../services/refundBankDetails.service");
test("pasted account numbers preserve leading zeros and remove spacing",()=>{
 assert.deepEqual(normalize({accountName:" Buyer ",accountNumber:" 0123 456-789 ",bankCode:" 058 "}),{accountName:"Buyer",accountNumber:"0123456789",bankCode:"058"});
});
test("validation identifies the invalid field without exposing account data",()=>{
 for(const [field,value] of [["accountName"," "],["accountNumber","123abc456"],["accountNumber",1234567890],["bankCode","Example Bank"]]){
  assert.throws(()=>normalize({accountName:"Buyer",accountNumber:"0123456789",bankCode:"058",[field]:value}),e=>e.statusCode===400 && e.field===field);
 }
});
