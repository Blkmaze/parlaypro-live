// Zero imports - uses Netlify Blobs REST API with the token injected at runtime
const SITE_ID = "658f40e1-9d0f-4072-80a5-d6d0eb35d77e";
const STORE = "sq3";

async function blobGet(token, key) {
  const r = await fetch(`https://api.netlify.com/api/v1/blobs/${SITE_ID}/${STORE}/${key}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (r.status === 404) return null;
  if (!r.ok) return null;
  return r.json();
}

async function blobSet(token, key, value) {
  await fetch(`https://api.netlify.com/api/v1/blobs/${SITE_ID}/${STORE}/${key}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(value)
  });
}

export default async (req, context) => {
  const url = new URL(req.url);
  const gameId = url.searchParams.get("gameId");
  if (!gameId) return new Response(JSON.stringify({error:"Missing gameId"}),{status:400,headers:{"Content-Type":"application/json"}});
  const token = process.env.NETLIFY_TOKEN;
  if (!token) return new Response(JSON.stringify({owners:{},rowNums:null,colNums:null,numbersLocked:false}),{status:200,headers:{"Content-Type":"application/json"}});
  try {
    const data = await blobGet(token, gameId) || {owners:{},rowNums:null,colNums:null,numbersLocked:false};
    return new Response(JSON.stringify(data),{status:200,headers:{"Content-Type":"application/json"}});
  } catch(err) {
    return new Response(JSON.stringify({owners:{},error:err.message}),{status:200,headers:{"Content-Type":"application/json"}});
  }
};
export const config = { path: "/api/squares" };

