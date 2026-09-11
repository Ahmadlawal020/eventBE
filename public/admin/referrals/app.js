"use strict";
const $ = id => document.getElementById(id);
let accessToken = "", policies = [], selected = "GLOBAL", members = new Map(), preview = null, choosingUser = false;
const message = (text, error = false) => { $("message").textContent = text; $("message").className = error ? "error" : ""; };
const api = async (path, method = "GET", data, retry = true) => {
  const response = await fetch("/api/admin/" + path, {
    method, credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(accessToken ? { Authorization: "Bearer " + accessToken } : {}) },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  if (response.status === 401 && retry && !path.startsWith("auth/")) {
    const session = await api("auth/refresh", "POST", {}, false);
    accessToken = session.accessToken;
    return api(path,method,data,false);
  }
  const body = response.status === 204 ? {} : await response.json();
  if (!response.ok || body.success === false) throw new Error(body.message || "Request failed");
  return body.data;
};
const guarded = fn => async event => {
  event?.preventDefault();
  const button = event?.submitter || (event?.currentTarget?.tagName === "BUTTON" ? event.currentTarget : null);
  if (button) button.disabled = true;
  try { await fn(event); } catch (error) { message(error.message,true); }
  finally { if (button) button.disabled = false; }
};
const period = p => p ? p.value === 0 ? "Unlimited (legacy)" : p.value + " " + p.unit.toLowerCase() : "Inherit";
const money = amount => new Intl.NumberFormat("en-NG",{ style:"currency",currency:"NGN" }).format(amount);
const policy = () => policies.find(p => p.key === selected);
const resetPreview = () => { preview = null; $("preview").hidden = true; $("confirm-past").checked = false; $("apply-past").disabled = true; };
const showMembers = () => {
  $("selected-users").replaceChildren();
  for (const [id,name] of members) {
    const button = document.createElement("button");
    button.textContent = name + " - Remove";
    button.onclick = () => { members.delete(id); showMembers(); };
    $("selected-users").append(button);
  }
};
const render = () => {
  resetPreview();
  const p = policy(), rule = p?.revisions.at(-1), global = selected === "GLOBAL";
  const group = selected === "NEW_GROUP" || p?.scope === "GROUP";
  $("policy-title").textContent = rule?.name || (group ? "New group" : "Individual referrer");
  $("policy-status").textContent = rule ? rule.status +  " - version " + p.version : "Not saved";
  $("scope-description").textContent = global ? "Default terms for all referrers." : group ? "These terms apply to the selected commission earners." : "These terms override this referrer's group and global defaults.";
  $("actions").hidden = !p?.version;
  $("inherit").hidden = global;
  $("group-fields").hidden = !group;
  $("entry-fields").hidden = !global;
  $("entry-help").hidden = !global;
  $("picker").hidden = !group && !choosingUser;
  $("policy-name").value = rule?.name || "";
  $("priority").value = rule?.priority ?? 0;
  $("rate").value = rule?.commissionPercentage ?? "";
  $("rate").required = global;
  $("duration").value = rule?.duration?.value ?? "";
  $("duration").required = global;
  $("duration-unit").value = rule?.duration?.unit || "WEEKS";
  $("entry-value").value = rule?.entryWindow?.value ?? 14;
  $("entry-unit").value = rule?.entryWindow?.unit || "DAYS";
  $("entry-value").required = global;
  $("reason").value = "";
  if (p) members = new Map((rule.userIds || []).map(id => [id, members.get(id) || "Loading member..."]));
  showMembers();
  if (group && p?.revisions.at(-1).userIds?.length) {
    const activeKey = selected;
    api("referrals/users?ids=" + p.revisions.at(-1).userIds.join(",")).then(users => {
      if (activeKey !== selected) return;
      for (const user of users) if (members.has(user._id)) members.set(user._id,user.firstName + " " + user.surname + " (" + user.email + ")");
      showMembers();
    }).catch(error => message(error.message,true));
  }
  $("history").replaceChildren();
  for (const revision of [...(p?.revisions || [])].reverse()) {
    const row = document.createElement("tr");
    const values = [new Date(revision.effectiveAt).getTime() === 0 ? "Original settings" : new Date(revision.effectiveAt).toLocaleString(),
      revision.commissionPercentage === null ? "Inherit" : revision.commissionPercentage + "%",
      period(revision.duration), revision.status, revision.reason || "?"];
    for (const value of values) { const td = document.createElement("td"); td.textContent = value; row.append(td); }
    $("history").append(row);
  }
};
const loadPolicies = async () => {
  policies = await api("referrals/policies");
  $("policy-select").replaceChildren();
  for (const p of policies) {
    const option = document.createElement("option");
    option.value = p.key; option.textContent = p.revisions.at(-1).name || p.scope;
    $("policy-select").append(option);
  }
  if (!policy()) selected = "GLOBAL";
  $("policy-select").value = selected;
  render();
};
const openDashboard = async () => {
  await loadPolicies();
  $("login-panel").hidden = true; $("dashboard").hidden = false; $("logout").hidden = false;
};
$("login").addEventListener("submit", guarded(async () => {
  const session = await api("auth/login","POST",{email:$("email").value,password:$("password").value},false);
  accessToken = session.accessToken; $("password").value = ""; await openDashboard(); message("Signed in.");
}));
$("logout").onclick = guarded(async () => {
  await api("auth/logout","POST",{});
  accessToken = ""; policies = []; members.clear(); resetPreview();
  $("login-panel").hidden = false; $("dashboard").hidden = true; $("logout").hidden = true; message("Signed out.");
});
$("policy-select").onchange = () => { selected = $("policy-select").value; choosingUser = false; render(); };
$("new-group").onclick = () => { selected = "NEW_GROUP"; choosingUser = false; members.clear(); render(); message("Name this group, choose its members, then save."); };
$("new-user").onclick = () => { choosingUser = true; $("picker").hidden = false; message("Search for the user whose earnings you want to manage."); };
$("search-users").onclick = guarded(async () => {
  const users = await api("referrals/users?q=" + encodeURIComponent($("user-search").value));
  $("user-results").replaceChildren();
  for (const user of users) {
    const name = user.firstName + " " + user.surname;
    const button = document.createElement("button"); button.textContent = name + " - " + user.email;
    button.onclick = () => {
      if (choosingUser) {
        selected = "USER:" + user._id; choosingUser = false;
        if (!policy()) policies.push({ key:selected, scope:"USER", version:0, targetUser:user._id,
          revisions:[{ name, status:"INHERIT", userIds:[], effectiveAt:new Date().toISOString(), commissionPercentage:null }] });
        render();
      } else { members.set(user._id,name); showMembers(); }
    };
    $("user-results").append(button);
  }
  if (!users.length) $("user-results").textContent = "No matching users.";
});
$("settings").addEventListener("submit", guarded(async () => {
  const p = policy(), global = selected === "GLOBAL", group = selected === "NEW_GROUP" || p?.scope === "GROUP";
  const body = { expectedVersion:p?.version || 0, commissionPercentage:$("rate").value === "" ? null : Number($("rate").value),
    duration:$("duration").value === "" ? null : {value:Number($("duration").value),unit:$("duration-unit").value},
    reason:$("reason").value };
  if (global) body.entryWindow = {value:Number($("entry-value").value),unit:$("entry-unit").value};
  if (group) Object.assign(body,{name:$("policy-name").value,priority:Number($("priority").value),userIds:[...members.keys()]});
  if (p?.scope === "USER" && !p.version) body.name = p.revisions[0].name;
  const saved = selected === "NEW_GROUP" ? await api("referrals/groups","POST",body) :
    await api("referrals/policies/" + encodeURIComponent(selected),"PUT",body);
  selected = saved.key; await loadPolicies(); message("Saved. Future qualifying transactions use these settings; past earnings are unchanged.");
}));
for (const button of $("actions").querySelectorAll("[data-action]")) button.onclick = guarded(async () => {
  const p = policy();
  await api("referrals/policies/" + encodeURIComponent(selected),"PUT",
    {expectedVersion:p.version,action:button.dataset.action,reason:$("reason").value});
  await loadPolicies(); message("Referral earning status updated.");
});
const localDate = date => new Date(date.getTime() - date.getTimezoneOffset()*60000).toISOString().slice(0,16);
$("past-from").value = localDate(new Date(Date.now()-30*86400000));
$("past-to").value = localDate(new Date());
$("preview-form").addEventListener("submit", guarded(async () => {
  if (!policy()?.version) throw new Error("Save this policy first");
  preview = await api("referrals/adjustments/preview","POST",{
    scopeKey:selected,from:new Date($("past-from").value).toISOString(),to:new Date($("past-to").value).toISOString(),
    rate:Number($("past-rate").value),reason:$("past-reason").value,
  });
  $("preview").hidden = false; $("confirm-past").checked = false; $("apply-past").disabled = true;
  $("preview-summary").textContent = preview.count + " earnings: " + money(preview.previousTotal) + " to " + money(preview.revisedTotal) + ". Preview expires in 30 minutes.";
}));
$("confirm-past").onchange = () => { $("apply-past").disabled = !$("confirm-past").checked || !preview?.count; };
$("apply-past").onclick = guarded(async () => {
  if (!preview || !$("confirm-past").checked) return;
  const result = await api("referrals/adjustments/" + preview.id + "/apply","POST",{confirm:true});
  resetPreview();
  message(result.appliedCount + " earnings adjusted." + (result.status === "PARTIAL" ? " Some records changed after the preview and were left untouched. Preview again to review them." : ""));
});
(async () => {
  try { const session = await api("auth/refresh","POST",{},false); accessToken = session.accessToken; await openDashboard(); }
  catch { /* Login form remains available when no administrator session exists. */ }
})();
