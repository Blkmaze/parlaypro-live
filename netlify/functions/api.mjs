// ParlayPro Live API - ASCII only
const SITE_ID    = "d6f0d30b-ccaa-461e-9973-f13ee862343b";
const STORE      = "prlive";
const ADMIN_PIN  = process.env.ADMIN_PIN  || "2826";
const MASTER_PIN = process.env.MASTER_PIN || "0614";
const ORIGIN     = "https://parlaypro-live.netlify.app";

function corsHeaders(req) {
  var origin = req.headers.get("origin") || "";
  var allowed = origin === ORIGIN || origin === "http://localhost:8888";
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": allowed ? origin : ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "X-Content-Type-Options": "nosniff"
  };
}
function json(req, data, status) {
  return new Response(JSON.stringify(data), { status: status||200, headers: corsHeaders(req) });
}
function validPin(p) { return p === ADMIN_PIN || p === MASTER_PIN; }
function sanitizeGameId(raw) {
  if (typeof raw !== "string") return null;
  var c = raw.replace(/[^A-Za-z0-9_\-]/g,"").slice(0,64);
  return c.length>=3 ? c : null;
}
function sanitizeInitials(raw) {
  if (typeof raw !== "string") return null;
  var c = raw.replace(/[^A-Za-z0-9]/g,"").toUpperCase().slice(0,4);
  return c.length>=2 ? c : null;
}
function sanitizeSport(raw) {
  var allowed=["ncaam","ncaaw","nba","wnba","nhl","mlb","nfl","mls"];
  return allowed.indexOf(raw)!==-1 ? raw : "nba";
}
async function blobGet(token,key) {
  var r = await fetch("https://api.netlify.com/api/v1/blobs/"+SITE_ID+"/"+STORE+"/"+encodeURIComponent(key),{headers:{Authorization:"Bearer "+token}});
  if(!r.ok) return null;
  var t = await r.text();
  try{return JSON.parse(t);}catch(e){return null;}
}
async function blobSet(token,key,value) {
  var r = await fetch("https://api.netlify.com/api/v1/blobs/"+SITE_ID+"/"+STORE+"/"+encodeURIComponent(key),{method:"PUT",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},body:JSON.stringify(value)});
  if(!r.ok) {
    var errText = await r.text().catch(()=>"");
    throw new Error("Blob write failed: "+r.status+" "+errText.slice(0,100));
  }
}
async function blobList(token,prefix) {
  var r = await fetch("https://api.netlify.com/api/v1/blobs/"+SITE_ID+"/"+STORE+"?prefix="+encodeURIComponent(prefix||""),{headers:{Authorization:"Bearer "+token}});
  if(!r.ok) return [];
  var t = await r.text();
  try{var d=JSON.parse(t);return d.blobs||[];}catch(e){return [];}
}
var emptySquares=function(){return{owners:{},pending:{},rowNums:null,colNums:null,numbersLocked:false};};

export default async function handler(req,context) {
  var url=new URL(req.url);
  var path=url.pathname;
  var method=req.method.toUpperCase();
  if(method==="OPTIONS") return new Response(null,{status:204,headers:corsHeaders(req)});
  var body={};
  if(method==="POST"){try{var raw=await req.text();body=JSON.parse(raw);}catch(e){body={};}}
  var token=process.env.NETLIFY_TOKEN;

  // ── SCORES ────────────────────────────────────────────────────
  if(path==="/api/scores"&&method==="GET"){
    var SPORTS={ncaam:"https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard",ncaaw:"https://site.api.espn.com/apis/site/v2/sports/basketball/womens-college-basketball/scoreboard",nba:"https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard",wnba:"https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/scoreboard",nhl:"https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard",mlb:"https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard",nfl:"https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard",mls:"https://site.api.espn.com/apis/site/v2/sports/soccer/usa.1/scoreboard"};
    var sport=sanitizeSport(url.searchParams.get("sport"));
    var date=(url.searchParams.get("date")||"").replace(/[^0-9]/g,"").slice(0,8);
    var espnUrl=date?SPORTS[sport]+"?dates="+date:SPORTS[sport];
    try{
      var res=await fetch(espnUrl);
      var edata=await res.json();
      var games=(edata.events||[]).map(function(e){
        var c=e.competitions&&e.competitions[0];
        var home=c&&c.competitors&&c.competitors.find(function(t){return t.homeAway==="home";});
        var away=c&&c.competitors&&c.competitors.find(function(t){return t.homeAway==="away";});
        var s=c&&c.status&&c.status.type;
        return{id:e.id,name:e.name,home:home&&home.team&&home.team.abbreviation||"",homeScore:home&&home.score||"0",away:away&&away.team&&away.team.abbreviation||"",awayScore:away&&away.score||"0",status:s&&s.completed?"FINAL":s&&s.inProgress?"LIVE":"SCHEDULED",period:c&&c.status&&c.status.period||0,time:e.date?new Date(e.date).toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",timeZone:"America/New_York"})+" ET":""};
      });
      return json(req,{sport:sport,games:games});
    }catch(e){return json(req,{error:"Server error"},500);}
  }

  // ── SQUARES ───────────────────────────────────────────────────
  if(path==="/api/squares"&&method==="GET"){
    var gameId=sanitizeGameId(url.searchParams.get("gameId"));
    if(!gameId) return json(req,{error:"Invalid gameId"},400);
    if(!token) return json(req,emptySquares());
    try{var data=await blobGet(token,gameId)||emptySquares();return json(req,data);}catch(e){return json(req,emptySquares());}
  }

  if(path==="/api/auto-assign"&&method==="POST"){
    if(!token) return json(req,{error:"Server error"},500);
    var gameId=sanitizeGameId(body.gameId);
    var initials=sanitizeInitials(body.initials);
    var qty=parseInt(body.qty,10);
    var isPending=!!body.pending;
    var payMethod=["cash","cashapp","paypal","card"].indexOf(body.payMethod)!==-1?body.payMethod:"unknown";
    var amount=typeof body.amount==="string"?body.amount.replace(/[^0-9.]/g,"").slice(0,8):"?";
    if(!gameId) return json(req,{error:"Invalid gameId"},400);
    if(!initials) return json(req,{error:"Invalid initials"},400);
    if(!qty||qty<1||qty>20) return json(req,{error:"Qty must be 1-20"},400);
    try{
      var data=await blobGet(token,gameId)||emptySquares();
      var owners=data.owners||{};var pending=data.pending||{};
      var open=[];for(var i=0;i<100;i++){if(owners[i]===undefined&&pending[i]===undefined)open.push(i);}
      if(!open.length) return json(req,{error:"No open squares"},409);
      for(var i=open.length-1;i>0;i--){var j=Math.floor(Math.random()*(i+1));var tmp=open[i];open[i]=open[j];open[j]=tmp;}
      var assigned=open.slice(0,Math.min(qty,open.length));
      if(isPending){assigned.forEach(function(idx){pending[idx]={initials:initials,payMethod:payMethod,amount:amount,ts:Date.now()};});data.pending=pending;}
      else{assigned.forEach(function(idx){owners[idx]=initials;});data.owners=owners;}
      await blobSet(token,gameId,data);
      return json(req,{ok:true,indices:assigned,initials:initials});
    }catch(e){return json(req,{error:"Server error"},500);}
  }

  if(path==="/api/reset-squares"&&method==="POST"){
    if(!token) return json(req,{error:"Server error"},500);
    var gameId=sanitizeGameId(body.gameId);var pin=typeof body.pin==="string"?body.pin.slice(0,8):"";
    if(!gameId||!pin) return json(req,{error:"Missing fields"},400);
    if(!validPin(pin)) return json(req,{error:"Invalid PIN"},403);
    try{await blobSet(token,gameId,{owners:{},pending:{},rowNums:null,colNums:null,numbersLocked:false,resetAt:Date.now()});return json(req,{ok:true});}
    catch(e){return json(req,{error:"Server error"},500);}
  }

  if(path==="/api/confirm-pending"&&method==="POST"){
    if(!token) return json(req,{error:"Server error"},500);
    var gameId=sanitizeGameId(body.gameId);var pin=typeof body.pin==="string"?body.pin.slice(0,8):"";
    if(!gameId) return json(req,{error:"Missing gameId"},400);
    if(!validPin(pin)) return json(req,{error:"Invalid PIN"},403);
    try{
      var data=await blobGet(token,gameId)||emptySquares();
      var owners=data.owners||{};var pending=data.pending||{};var confirmed=[];
      var indices=Array.isArray(body.indices)?body.indices:Object.keys(pending).map(Number);
      indices.forEach(function(i){var p=pending[i];if(p){owners[i]=p.initials;delete pending[i];confirmed.push(i);}});
      data.owners=owners;data.pending=pending;await blobSet(token,gameId,data);
      return json(req,{ok:true,confirmed:confirmed});
    }catch(e){return json(req,{error:"Server error"},500);}
  }

  if(path==="/api/reject-pending"&&method==="POST"){
    if(!token) return json(req,{error:"Server error"},500);
    var gameId=sanitizeGameId(body.gameId);var pin=typeof body.pin==="string"?body.pin.slice(0,8):"";
    if(!gameId||!pin) return json(req,{error:"Missing fields"},400);
    if(!validPin(pin)) return json(req,{error:"Invalid PIN"},403);
    try{
      var data=await blobGet(token,gameId)||emptySquares();var pending=data.pending||{};
      var indices=Array.isArray(body.indices)?body.indices:Object.keys(pending).map(Number);
      indices.forEach(function(i){delete pending[i];});data.pending=pending;
      await blobSet(token,gameId,data);return json(req,{ok:true});
    }catch(e){return json(req,{error:"Server error"},500);}
  }

  if(path==="/api/lock-numbers"&&method==="POST"){
    if(!token) return json(req,{error:"Server error"},500);
    var gameId=sanitizeGameId(body.gameId);var pin=typeof body.pin==="string"?body.pin.slice(0,8):"";
    if(!gameId||!pin) return json(req,{error:"Missing fields"},400);
    if(!validPin(pin)) return json(req,{error:"Invalid PIN"},403);
    try{
      var data=await blobGet(token,gameId)||emptySquares();
      if(body.rowNums) data.rowNums=body.rowNums;if(body.colNums) data.colNums=body.colNums;
      data.numbersLocked=true;await blobSet(token,gameId,data);return json(req,{ok:true});
    }catch(e){return json(req,{error:"Server error"},500);}
  }

  // ── PICK'EM ENTRIES ───────────────────────────────────────────
  // POST /api/pickem-entry — save a new entry
  if(path==="/api/pickem-entry"&&method==="POST"){
    if(!token) return json(req,{error:"Server error"},500);
    var initials=sanitizeInitials(body.initials);
    if(!initials) return json(req,{error:"Invalid initials"},400);
    var mode=["power","flex"].indexOf(body.mode)!==-1?body.mode:"power";
    var entry=parseFloat(body.entry)||10;
    var payout=parseFloat(body.payout)||0;
    var picks=Array.isArray(body.picks)?body.picks.slice(0,5):[];
    var payMethod=["cashapp","paypal","card"].indexOf(body.payMethod)!==-1?body.payMethod:"unknown";
    if(!picks.length) return json(req,{error:"No picks"},400);
    try{
      var entryId="pe_"+Date.now()+"_"+Math.random().toString(36).slice(2,6);
      var entryData={
        id:entryId,
        initials:initials,
        mode:mode,
        entry:entry,
        payout:payout,
        picks:picks.map(function(p){return{name:String(p.name||"").slice(0,40),stat:String(p.stat||"pts").slice(0,10),line:parseFloat(p.line)||0,side:["more","less"].indexOf(p.side)!==-1?p.side:"more",game:String(p.game||"").slice(0,60)};}),
        payMethod:payMethod,
        status:"pending",
        ts:Date.now(),
        date:new Date().toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})
      };
      await blobSet(token,entryId,entryData);
      // Also maintain an index of all entries
      var index=await blobGet(token,"pickem_index")||{entries:[]};
      index.entries.push({id:entryId,initials:initials,ts:Date.now(),entry:entry,payout:payout,status:"pending",picks:picks.length});
      // Keep last 500 entries in index
      if(index.entries.length>500) index.entries=index.entries.slice(-500);
      await blobSet(token,"pickem_index",index);
      return json(req,{ok:true,entryId:entryId});
    }catch(e){return json(req,{error:e.message||"Server error",debug:String(e)},500);}
  }

  // GET /api/pickem-entries — admin fetch all entries
  if(path==="/api/pickem-entries"&&method==="GET"){
    if(!token) return json(req,{error:"Server error"},500);
    var pin=url.searchParams.get("pin")||"";
    if(!validPin(pin)) return json(req,{error:"Invalid PIN"},403);
    try{
      var index=await blobGet(token,"pickem_index")||{entries:[]};
      // Fetch full details for recent entries (last 50)
      var recent=index.entries.slice(-50).reverse();
      var full=await Promise.all(recent.map(async function(e){
        try{return await blobGet(token,e.id)||e;}catch(err){return e;}
      }));
      return json(req,{ok:true,entries:full,total:index.entries.length});
    }catch(e){return json(req,{error:"Server error"},500);}
  }

  // POST /api/pickem-settle — admin enters final stats, system calculates winners
  if(path==="/api/pickem-settle"&&method==="POST"){
    if(!token) return json(req,{error:"Server error"},500);
    var pin=typeof body.pin==="string"?body.pin.slice(0,8):"";
    if(!validPin(pin)) return json(req,{error:"Invalid PIN"},403);
    var entryId=typeof body.entryId==="string"?body.entryId.slice(0,40):"";
    var finalStats=body.finalStats||{}; // {playerName: actualStat}
    if(!entryId) return json(req,{error:"Missing entryId"},400);
    try{
      var entry=await blobGet(token,entryId);
      if(!entry) return json(req,{error:"Entry not found"},404);
      // Grade each pick
      var correct=0;
      entry.picks.forEach(function(pick){
        var actual=finalStats[pick.name];
        if(actual===undefined||actual===null) return;
        actual=parseFloat(actual);
        var hit=(pick.side==="more"&&actual>pick.line)||(pick.side==="less"&&actual<pick.line);
        pick.actual=actual;
        pick.result=hit?"win":"loss";
        if(hit) correct++;
      });
      var n=entry.picks.length;
      // Calculate payout based on mode
      var POWER={2:3,3:6,4:10,5:20};
      var FLEX={3:{3:3,2:1},4:{4:6,3:1.5},5:{5:10,4:2.5}};
      var multiplier=0;
      if(entry.mode==="power"){
        multiplier=correct===n?(POWER[n]||0):0;
      } else {
        var flexTable=FLEX[n]||{};
        multiplier=flexTable[correct]||0;
      }
      var winAmount=multiplier>0?(entry.entry*multiplier).toFixed(2):"0.00";
      entry.status=multiplier>0?"won":"lost";
      entry.correct=correct;
      entry.multiplier=multiplier;
      entry.winAmount=winAmount;
      entry.settledAt=Date.now();
      entry.settledBy=pin===MASTER_PIN?"master":"admin";
      await blobSet(token,entryId,entry);
      // Update index
      var index=await blobGet(token,"pickem_index")||{entries:[]};
      var idx=index.entries.findIndex(function(e){return e.id===entryId;});
      if(idx>=0){index.entries[idx].status=entry.status;index.entries[idx].winAmount=winAmount;}
      await blobSet(token,"pickem_index",index);
      return json(req,{ok:true,correct:correct,total:n,multiplier:multiplier,winAmount:winAmount,status:entry.status,picks:entry.picks});
    }catch(e){return json(req,{error:"Server error"},500);}
  }

  // POST /api/pickem-settle-all — settle all open entries for a game using ESPN final stats
  if(path==="/api/pickem-settle-all"&&method==="POST"){
    if(!token) return json(req,{error:"Server error"},500);
    var pin=typeof body.pin==="string"?body.pin.slice(0,8):"";
    if(!validPin(pin)) return json(req,{error:"Invalid PIN"},403);
    var finalStats=body.finalStats||{}; // {playerName: actualStat}
    try{
      var index=await blobGet(token,"pickem_index")||{entries:[]};
      var pending=index.entries.filter(function(e){return e.status==="pending";});
      var settled=0;var totalWon=0;
      for(var i=0;i<pending.length;i++){
        try{
          var entry=await blobGet(token,pending[i].id);
          if(!entry||entry.status!=="pending") continue;
          var correct=0;
          entry.picks.forEach(function(pick){
            var actual=finalStats[pick.name];
            if(actual===undefined) return;
            actual=parseFloat(actual);
            pick.actual=actual;
            var hit=(pick.side==="more"&&actual>pick.line)||(pick.side==="less"&&actual<pick.line);
            pick.result=hit?"win":"loss";
            if(hit) correct++;
          });
          var n=entry.picks.length;
          var POWER={2:3,3:6,4:10,5:20};
          var FLEX={3:{3:3,2:1},4:{4:6,3:1.5},5:{5:10,4:2.5}};
          var multiplier=0;
          if(entry.mode==="power"){multiplier=correct===n?(POWER[n]||0):0;}
          else{var ft=FLEX[n]||{};multiplier=ft[correct]||0;}
          entry.status=multiplier>0?"won":"lost";
          entry.correct=correct;entry.multiplier=multiplier;
          entry.winAmount=multiplier>0?(entry.entry*multiplier).toFixed(2):"0.00";
          entry.settledAt=Date.now();
          await blobSet(token,pending[i].id,entry);
          var idx2=index.entries.findIndex(function(e){return e.id===pending[i].id;});
          if(idx2>=0){index.entries[idx2].status=entry.status;index.entries[idx2].winAmount=entry.winAmount;}
          settled++;
          if(multiplier>0) totalWon+=parseFloat(entry.winAmount);
        }catch(err){}
      }
      await blobSet(token,"pickem_index",index);
      return json(req,{ok:true,settled:settled,totalWon:totalWon.toFixed(2)});
    }catch(e){return json(req,{error:"Server error"},500);}
  }

  return json(req,{error:"Not found"},404);
}

export const config = {
  path: [
    "/api/scores","/api/squares","/api/auto-assign","/api/lock-numbers",
    "/api/reset-squares","/api/confirm-pending","/api/reject-pending",
    "/api/pickem-entry","/api/pickem-entries","/api/pickem-settle","/api/pickem-settle-all"
  ]
};
