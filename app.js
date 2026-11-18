const $=id=>document.getElementById(id);
let supabase=null, user=null, profile=null, scanner=null, cameras=[], cameraOn=false, scanBusy=false, lastValue="", lastAt=0;
const cfg=window.XSPACE_CONFIG||{};
const configured=cfg.SUPABASE_URL&&cfg.SUPABASE_ANON_KEY&&!cfg.SUPABASE_URL.includes("YOUR_")&&!cfg.SUPABASE_ANON_KEY.includes("YOUR_");
if(!configured){$("config-warning").hidden=false;$("login-button").disabled=true;}
else if(window.supabase?.createClient){supabase=window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY);}
function message(id,text,kind=""){const el=$(id);el.textContent=text;el.className="notice "+kind;el.hidden=false;}
function hidePanels(){$("login-panel").hidden=true;$("admin-panel").hidden=true;$("staff-panel").hidden=true;}
async function signIn(){
 $("login-button").disabled=true;$("login-error").hidden=true;
 try{
  const {data,error}=await supabase.auth.signInWithPassword({email:$("email").value.trim(),password:$("password").value});
  if(error)throw error;user=data.user;
  const p=await supabase.rpc("current_staff_profile");if(p.error)throw p.error;profile=p.data;
  hidePanels();
  if(profile.role==="ADMIN"){ $("admin-panel").hidden=false;$("admin-welcome").textContent=profile.full_name+" · ADMIN";await loadAdmin();}
  else if(profile.role==="ENTRY"||profile.role==="EXIT"){ $("staff-panel").hidden=false;$("staff-welcome").textContent=profile.full_name+" · "+profile.role;$("role-banner").textContent=profile.role==="ENTRY"?"ENTRY MODE — authorised scans mark tickets INSIDE.":"EXIT MODE — authorised scans mark tickets OUTSIDE.";}
  else throw new Error("This account has no permitted XSpace role.");
 }catch(e){await supabase.auth.signOut();$("login-panel").hidden=false;message("login-error",e.message||"Sign-in failed.","error");}
 finally{$("login-button").disabled=false;$("password").value="";}
}
async function signOut(){await stopCamera();await supabase.auth.signOut();user=null;profile=null;hidePanels();$("login-panel").hidden=false;}
async function loadAdmin(){
 $("refresh-admin").disabled=true;
 try{
  const [summary,tickets,history]=await Promise.all([
   supabase.rpc("admin_dashboard_summary"),supabase.rpc("admin_ticket_list",{p_limit:300}),supabase.rpc("admin_recent_scan_history",{p_limit:100})
  ]);
  for(const r of [summary,tickets,history])if(r.error)throw r.error;
  const s=summary.data||{};
  $("stats").innerHTML=[["Tickets",s.total_tickets],["Inside",s.inside],["Outside",s.outside],["Accepted scans",s.accepted_scans],["Rejected scans",s.rejected_scans],["Active staff",s.active_staff]].map(([k,v])=>'<div class="stat"><b>'+Number(v||0)+'</b><span>'+k+'</span></div>').join("");
  $("ticket-rows").innerHTML=(tickets.data||[]).map(t=>'<tr><td>'+esc(t.ticket_id)+'</td><td>'+esc(t.status)+'</td><td>'+date(t.updated_at)+'</td></tr>').join("")||'<tr><td colspan="3">No tickets imported yet.</td></tr>';
  $("history-rows").innerHTML=(history.data||[]).map(h=>'<tr><td>'+date(h.scanned_at)+'</td><td>'+esc(h.ticket_id||"—")+'</td><td>'+esc(h.action)+'</td><td>'+esc(h.outcome)+(h.reason?" · "+esc(h.reason):"")+'</td><td>'+esc(h.staff_email)+'</td></tr>').join("")||'<tr><td colspan="5">No scans recorded yet.</td></tr>';
 }catch(e){alert("Could not load admin data: "+(e.message||e));}
 finally{$("refresh-admin").disabled=false;}
}
function esc(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function date(v){return v?new Date(v).toLocaleString():"—";}
async function startCamera(){
 if(!profile)return;
 if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia){message("scan-result","Camera scanning requires HTTPS and browser camera permission.","error");return;}
 $("start-camera").disabled=true;
 try{
  cameras=await Html5Qrcode.getCameras();if(!cameras.length)throw new Error("No camera detected.");
  const sel=$("camera-select");sel.innerHTML="";cameras.forEach((c,i)=>sel.add(new Option(c.label||("Camera "+(i+1)),c.id)));
  const rear=cameras.find(c=>/back|rear|environment|world/i.test(c.label||""))||cameras[cameras.length-1];sel.value=rear.id;sel.disabled=false;
  scanner=new Html5Qrcode("reader");
  await scanner.start(sel.value,{fps:10,qrbox:{width:250,height:250}},value=>{
   if(scanBusy||(value===lastValue&&Date.now()-lastAt<1800))return;
   lastValue=value;lastAt=Date.now();scanBusy=true;processScan(value).finally(()=>setTimeout(()=>scanBusy=false,1000));
  });
  cameraOn=true;$("stop-camera").hidden=false;sel.disabled=true;message("scan-result","Camera active. Scan a ticket QR code.");
 }catch(e){$("start-camera").disabled=false;message("scan-result",e.message||"Unable to start camera.","error");}
}
async function stopCamera(){if(scanner&&cameraOn){try{await scanner.stop();await scanner.clear();}catch(e){}}scanner=null;cameraOn=false;$("stop-camera").hidden=true;$("start-camera").disabled=false;$("camera-select").disabled=false;}
async function processScan(value){
 message("scan-result","Validating ticket…");
 try{
  const {data,error}=await supabase.rpc("process_ticket_scan",{p_qr_value:value});if(error)throw error;
  const good=data.outcome==="ACCEPTED";message("scan-result",data.message+(data.ticket_id?" · "+data.ticket_id:""),good?"success":"error");
 }catch(e){message("scan-result",e.message||"Scan failed. Check connection and sign-in.","error");}
}
function manual(){const v=$("manual-qr").value.trim();if(!v)return message("scan-result","Enter a QR value first.","error");if(scanBusy)return;scanBusy=true;processScan(v).finally(()=>{scanBusy=false;$("manual-qr").value="";});}
$("login-button").addEventListener("click",signIn);$("admin-logout").addEventListener("click",signOut);$("staff-logout").addEventListener("click",signOut);
$("refresh-admin").addEventListener("click",loadAdmin);$("start-camera").addEventListener("click",startCamera);$("stop-camera").addEventListener("click",stopCamera);$("manual-submit").addEventListener("click",manual);
$("password").addEventListener("keydown",e=>{if(e.key==="Enter")signIn();});
