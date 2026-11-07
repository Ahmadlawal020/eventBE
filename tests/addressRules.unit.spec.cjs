const {test}=require("node:test");
const assert=require("node:assert/strict");
const {validateAddress,formatAddress}=require("../services/addressRules");
for(const [kind,modelFile,settingsFile,serviceFile,method] of [
 ["event","../models/client/event.schema","../models/management/eventSettings.schema","../services/eventSettings.service","validateEventPayload"],
 ["event center","../models/client/eventCenter.schema","../models/management/eventCenterSettings.schema","../services/eventCenterSettings.service","validateVenuePayload"],
]){
 const Model=require(modelFile),Settings=require(settingsFile),validate=require(serviceFile)[method];
 test(kind+" persists all international fields without dropping country identity",()=>{
  const location={countryCode:"gb",country:"United Kingdom",flat:"Flat 1",building:"Test House",street:"10 Example Street",locality:"Westminster",district:"Central",city:"London",postcode:"SW1A 2AA",area:"",coordinates:{latitude:51.5,longitude:-.12}};
  const document=new Model({location});
  assert.equal(document.location.countryCode,"GB");
  for(const field of ["building","locality","district","flat"]) assert.equal(document.location[field],location[field]);
  assert.equal(Boolean(document.validateSync()?.errors["location.countryCode"]),false);
  assert.ok(new Model({location:{countryCode:"ZZ"}}).validateSync().errors["location.countryCode"]);
 });
 test(kind+" validates country fields during publication and partial draft edits",()=>{
  const settings=new Settings().toObject();
  const address={countryCode:"US",country:"United States",street:"100 Sunset Boulevard",city:"Los Angeles",area:"CA",postcode:"90028",coordinates:{latitude:34,longitude:-118}};
  address.addressString=formatAddress(address);
  for(const publishing of [false,true]){
   for(const patch of [{area:"Lagos"},{postcode:"xyz"},{country:"Nigeria"},{countryCode:"ZZ"}]){
    const location={...address,...patch},expected=Object.values(validateAddress(location,{requireComplete:publishing}));
    assert.ok(expected.length);
    const errors=validate({location},settings,{publishing});
    assert.ok(expected.every(message=>errors.includes(message)),JSON.stringify(errors));
   }
   const location={...address,countryCode:"SG",country:"Singapore",street:"1 Fullerton Road",city:"",area:"",postcode:"049213"};
   location.addressString=formatAddress(location);
   const errors=validate({location},settings,{publishing});
   assert.equal(errors.some(message=>/location|mapped venue address|\bcity\b.*required/i.test(message)),false,JSON.stringify(errors));
  }
  assert.equal(validate({location:{countryCode:"US"}},settings,{publishing:false}).some(message=>/ZIP code.*required/.test(message)),false);
  assert.ok(validate({location:{countryCode:"US"}},settings,{publishing:true}).some(message=>/ZIP code.*required/.test(message)));
 });
}
