// Full ObjectId encoded without truncation: stable, distinct codes for distinct users.
const codeForUser = (id) => "MN" + BigInt("0x" + String(id)).toString(36).toUpperCase();
module.exports = { codeForUser };
