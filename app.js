const $ = id => document.getElementById(id);
let session = null, qr = null, cameraOn = false, scanBusy = false, lastCode = "", lastAt = 0;
const backend = (window.XSPACE_CONFIG && window.XSPACE_CONFIG.APPS_SCRIPT_WEB_APP_URL || "").trim();
const PAGE_ORIGIN = "https://eventticketm.github.io";

function showError(message){$("login-error").textContent=message;$("login-error").hidden=false;}
function setStatus(message,kind=""){const el=$("scan-result");el.textContent=message;el.className="notice "+kind;}

function bridgeRequest(action, data={}) {
  if (!backend) return Promise.reject(new Error("Apps Script URL is missing from config.js."));
  const requestId = (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(16)+"-"+Math.random().toString(16).slice(2)+"-"+Math.random().toString(16).slice(2));
  return new Promise((resolve,reject)=>{
    const frame=document.createElement("iframe");
    frame.name="xspace_bridge_"+requestId;
    frame.title="XSpace secure scanner connection";
    frame.style.cssText="position:absolute;width:1px;height:1px;left:-10000px;border:0";
    const form=document.createElement("form");
    form.method="POST";form.action=backend;form.target=frame.name;
    form.style.display="none";
    const field=document.createElement("input");
    field.type="hidden";field.name="xspace_request";
    field.value=JSON.stringify({requestId,action,data});
    form.appendChild(field);
    let finished=false;
    const cleanup=()=>{
      window.removeEventListener("message",onMessage);
      form.remove();
      setTimeout(()=>frame.remove(),250);
    };
    const finish=(fn,value)=>{if(finished)return;finished=true;clearTimeout(timer);cleanup();fn(value);};
    const onMessage=(event)=>{
      if(event.origin!== "https://script.google.com" &&
         event.origin!== "https://script.googleusercontent.com" &&
         !event.origin.endsWith(".googleusercontent.com")) return;
      const msg=event.data;
      if(!msg || msg.type!=="xspace-scanner-response" || msg.requestId!==requestId) return;
      const res=msg.response||{};
      if(res.ok) finish(resolve,res.data);
      else finish(reject,new Error(res.error||"Scanner request failed."));
    };
    const timer=setTimeout(()=>finish(reject,new Error("The connection to XSpace timed out. Check your internet connection and Apps Script deployment.")),25000);
    window.addEventListener("message",onMessage);
    document.body.append(frame,form);
    try{form.submit();}catch(error){finish(reject,error);}
  });
}

async function signIn(){
  $("login-error").hidden=true;$("login-button").disabled=true;
  try{
    const user=await bridgeRequest("login",{email:$("email").value.trim(),pin:$("pin").value});
    if(!user || !["ENTRY","EXIT"].includes(user.role)) throw new Error("This scanner is for Entry and Exit staff only.");
    session=user;sessionStorage.setItem("xspaceScannerSession",JSON.stringify(user));renderSession();
    $("pin").value="";
  }catch(e){showError(e.message||String(e));}
  finally{$("login-button").disabled=false;}
}
function renderSession(){
  $("login-panel").hidden=true;$("scanner-panel").hidden=false;
  $("staff-name").textContent=(session.name||session.email)+" · "+session.role;
  $("role-box").textContent=session.role==="ENTRY"?"ENTRY MODE — accepted tickets are marked inside.":"EXIT MODE — accepted tickets are marked outside.";
}
async function signOut(){
  await stopCamera();
  if(session){try{await bridgeRequest("logout",{token:session.token});}catch(e){}}
  session=null;sessionStorage.removeItem("xspaceScannerSession");
  $("scanner-panel").hidden=true;$("login-panel").hidden=false;
}
async function startCamera(){
  if(!session)return;
  if(!window.Html5Qrcode){setStatus("Scanner library could not load. Check internet access and reload.","error");return;}
  if(!window.isSecureContext || !navigator.mediaDevices){setStatus("Camera access requires HTTPS and a supported browser.","error");return;}
  $("start-button").disabled=true;
  try{
    qr=new Html5Qrcode("reader");
    await qr.start({facingMode:"environment"},{fps:10,qrbox:{width:250,height:250}},decoded=>{
      if(scanBusy || (decoded===lastCode && Date.now()-lastAt<1800))return;
      lastCode=decoded;lastAt=Date.now();scanBusy=true;
      validateTicket(decoded).finally(()=>setTimeout(()=>scanBusy=false,1200));
    });
    cameraOn=true;$("stop-button").hidden=false;setStatus("Camera active. Point it at the ticket QR code.");
  }catch(e){$("start-button").disabled=false;setStatus("Camera could not start: "+(e.message||e)+". Allow camera permission for this site and try again.","error");}
}
async function stopCamera(){
  if(qr&&cameraOn){try{await qr.stop();await qr.clear();}catch(e){}}
  qr=null;cameraOn=false;$("stop-button").hidden=true;$("start-button").disabled=false;
}
async function validateTicket(code){
  setStatus("Checking ticket…");
  try{
    const result=await bridgeRequest("scanTicket",{token:session.token,qr:code});
    setStatus((result.message||result.result)+" · Ticket "+(result.ticketId||""),result.result==="ACCEPTED"?"success":"error");
  }catch(e){setStatus(e.message||String(e),"error");}
}
function manualScan(){
  const value=$("manual-qr").value.trim();if(!value)return setStatus("Enter a QR value first.","error");
  if(scanBusy)return;scanBusy=true;validateTicket(value).finally(()=>{scanBusy=false;$("manual-qr").value="";});
}
$("login-button").addEventListener("click",signIn);
$("start-button").addEventListener("click",startCamera);
$("stop-button").addEventListener("click",stopCamera);
$("logout-button").addEventListener("click",signOut);
$("manual-button").addEventListener("click",manualScan);
$("pin").addEventListener("keydown",e=>{if(e.key==="Enter")signIn();});
try{const restored=JSON.parse(sessionStorage.getItem("xspaceScannerSession")||"null");if(restored&&restored.token&&["ENTRY","EXIT"].includes(restored.role)){session=restored;renderSession();}}catch(e){sessionStorage.removeItem("xspaceScannerSession");}
