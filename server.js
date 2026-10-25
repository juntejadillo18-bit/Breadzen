require("dotenv").config();
const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const Database = require("better-sqlite3");
const crypto = require("crypto");
const path = require("path");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
const db = new Database(path.join(__dirname, "data", "pinoycart.sqlite"));
db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS orders (
 id TEXT PRIMARY KEY, created_at TEXT NOT NULL, customer_name TEXT NOT NULL,
 phone TEXT NOT NULL, address TEXT NOT NULL, payment_method TEXT NOT NULL,
 payment_status TEXT NOT NULL, order_status TEXT NOT NULL, subtotal INTEGER NOT NULL,
 items_json TEXT NOT NULL, paymongo_checkout_id TEXT, paymongo_url TEXT,
 notes TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS webhook_events (
 event_id TEXT PRIMARY KEY, received_at TEXT NOT NULL
);
`);

const products = [
 {id:1,color:"Turquoise",name:"Classic Polo Shirt — Turquoise",price:299,image:"polo-01.jpg"},
 {id:2,color:"Olive",name:"Classic Polo Shirt — Olive",price:299,image:"polo-02.jpg"},
 {id:3,color:"Slate Blue",name:"Classic Polo Shirt — Slate Blue",price:299,image:"polo-03.jpg"},
 {id:4,color:"Navy",name:"Classic Polo Shirt — Navy",price:299,image:"polo-04.jpg"},
 {id:5,color:"Purple",name:"Classic Polo Shirt — Purple",price:299,image:"polo-05.jpg"},
 {id:6,color:"Green",name:"Classic Polo Shirt — Green",price:299,image:"polo-06.jpg"},
 {id:7,color:"Light Green",name:"Classic Polo Shirt — Light Green",price:299,image:"polo-07.jpg"},
 {id:8,color:"Burgundy",name:"Classic Polo Shirt — Burgundy",price:299,image:"polo-08.jpg"},
 {id:9,color:"Gray",name:"Classic Polo Shirt — Gray",price:299,image:"polo-09.jpg"},
 {id:10,color:"Charcoal",name:"Classic Polo Shirt — Charcoal",price:299,image:"polo-10.jpg"},
 {id:11,color:"Beige",name:"Classic Polo Shirt — Beige",price:299,image:"polo-11.jpg"},
 {id:12,color:"Pink",name:"Classic Polo Shirt — Pink",price:299,image:"polo-12.jpg"},
 {id:13,color:"Black",name:"Classic Polo Shirt — Black",price:299,image:"polo-13.jpg"},
 {id:14,color:"Red",name:"Classic Polo Shirt — Red",price:299,image:"polo-14.jpg"},
 {id:15,color:"Royal Blue",name:"Classic Polo Shirt — Royal Blue",price:299,image:"polo-15.jpg"},
 {id:16,color:"White",name:"Classic Polo Shirt — White",price:299,image:"polo-16.jpg"}
];
const orderStatuses = ["New","Confirmed","Preparing","Shipped","Delivered","Cancelled"];
const paymentStatuses = ["Pending","Paid","Failed","Refunded"];

function requireEnv(name) {
  if (!process.env[name]) throw new Error(`Missing environment variable: ${name}`);
  return process.env[name];
}
function adminOnly(req,res,next) {
  if (req.session && req.session.isAdmin) return next();
  return res.status(401).json({error:"Admin login required"});
}
function safeEqual(a,b) {
  const aa=Buffer.from(String(a)); const bb=Buffer.from(String(b));
  return aa.length===bb.length && crypto.timingSafeEqual(aa,bb);
}
function verifyPayMongoSignature(rawBody, header, secret) {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(",").map(p=>p.trim().split("=",2)));
  if (!parts.t || !(parts.te || parts.li)) return false;
  const signed = `${parts.t}.${rawBody.toString("utf8")}`;
  const expected = crypto.createHmac("sha256",secret).update(signed).digest("hex");
  const candidates = [parts.te,parts.li].filter(Boolean);
  return candidates.some(candidate=>safeEqual(candidate,expected));
}

// PayMongo webhook must receive the raw body for signature verification.
app.post("/api/paymongo/webhook", express.raw({type:"application/json",limit:"1mb"}), (req,res) => {
  const secret = process.env.PAYMONGO_WEBHOOK_SECRET;
  if (!secret || !verifyPayMongoSignature(req.body, req.get("Paymongo-Signature"), secret)) {
    return res.status(400).send("Invalid webhook signature");
  }
  let event;
  try { event = JSON.parse(req.body.toString("utf8")); } catch { return res.status(400).send("Invalid JSON"); }
  const eventId = event.data && event.data.id;
  const eventType = event.data && event.data.attributes && event.data.attributes.type;
  if (!eventId || !eventType) return res.status(400).send("Missing event details");
  const already = db.prepare("SELECT event_id FROM webhook_events WHERE event_id=?").get(eventId);
  if (already) return res.status(200).send("Already processed");

  // Confirm the exact event names/attributes against the current PayMongo dashboard/API docs
  // before going live. Only mark an order paid when a trusted paid event maps to its checkout ID.
  const attrs = event.data.attributes || {};
  const data = attrs.data || {};
  const checkoutId = data.id || (data.attributes && data.attributes.checkout_session_id);
  const paidEvent = ["checkout_session.payment.paid","payment.paid"].includes(eventType);
  if (paidEvent && checkoutId) {
    db.prepare("UPDATE orders SET payment_status='Paid', order_status=CASE WHEN order_status='New' THEN 'Confirmed' ELSE order_status END WHERE paymongo_checkout_id=?").run(checkoutId);
  }
  db.prepare("INSERT OR IGNORE INTO webhook_events(event_id,received_at) VALUES(?,?)").run(eventId,new Date().toISOString());
  return res.status(200).send("ok");
});

app.use(express.json({limit:"100kb"}));
app.use(helmet({contentSecurityPolicy:false}));
app.use(session({
  name:"pinoycart.sid",
  secret:process.env.SESSION_SECRET || "development-only-change-this-secret",
  resave:false, saveUninitialized:false,
  cookie:{httpOnly:true,sameSite:"lax",secure:process.env.NODE_ENV==="production",maxAge:1000*60*60*8}
}));
app.use("/api", rateLimit({windowMs:60*1000,limit:120,standardHeaders:true,legacyHeaders:false}));
app.use(express.static(path.join(__dirname,"public")));

app.get("/api/products",(req,res)=>res.json(products));
app.get("/api/health",(req,res)=>res.json({ok:true,service:"PinoyCart"}));

app.post("/api/orders", async (req,res) => {
  try {
    const {customer,paymentMethod,items} = req.body || {};
    if (!customer || typeof customer.name!=="string" || typeof customer.phone!=="string" || typeof customer.address!=="string") {
      return res.status(400).json({error:"Please provide your name, phone number, and delivery address."});
    }
    if (!customer.name.trim() || !customer.phone.trim() || !customer.address.trim() ||
        customer.name.length>120 || customer.phone.length>30 || customer.address.length>500) {
      return res.status(400).json({error:"Please check your customer details."});
    }
    if (!["cod","gcash"].includes(paymentMethod)) return res.status(400).json({error:"Unsupported payment method."});
    if (!Array.isArray(items) || items.length<1 || items.length>50) return res.status(400).json({error:"Cart is empty or too large."});
    const normalized = [];
    for (const item of items) {
      const product = products.find(p=>p.id===Number(item.id));
      const quantity = Number(item.quantity);
      if (!product || !Number.isInteger(quantity) || quantity<1 || quantity>20) return res.status(400).json({error:"Invalid product or quantity."});
      normalized.push({id:product.id,name:product.name,color:product.color,price:product.price,image:product.image,quantity});
    }
    const subtotal = normalized.reduce((sum,item)=>sum+item.price*item.quantity,0);
    const id = "PC-" + crypto.randomBytes(6).toString("hex").toUpperCase();
    const createdAt = new Date().toISOString();
    let checkoutId = null, checkoutUrl = null;
    const paymentStatus = paymentMethod==="cod" ? "Pending" : "Pending";
    db.prepare(`INSERT INTO orders
      (id,created_at,customer_name,phone,address,payment_method,payment_status,order_status,subtotal,items_json)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run(id,createdAt,customer.name.trim(),customer.phone.trim(),customer.address.trim(),
      paymentMethod,paymentStatus,"New",subtotal,JSON.stringify(normalized));

    if (paymentMethod==="gcash") {
      try {
        const secret = requireEnv("PAYMONGO_SECRET_KEY");
        if (!secret.startsWith("sk_") || secret.includes("replace_me")) throw new Error("Set a valid PayMongo secret key first.");
        const payload = {data:{attributes:{
          line_items:normalized.map(item=>({currency:"PHP",amount:item.price*100,name:item.name,quantity:item.quantity})),
          payment_method_types:["gcash"],
          success_url:`${BASE_URL}/payment-success.html?order=${encodeURIComponent(id)}`,
          cancel_url:`${BASE_URL}/payment-cancelled.html?order=${encodeURIComponent(id)}`,
          description:`PinoyCart order ${id}`,
          reference_number:id,
          send_email_receipt:false
        }}};
        const response = await fetch(`${process.env.PAYMONGO_API_BASE || "https://api.paymongo.com/v1"}/checkout_sessions`,{
          method:"POST",
          headers:{Authorization:"Basic "+Buffer.from(secret+":").toString("base64"),"Content-Type":"application/json"},
          body:JSON.stringify(payload)
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.errors?.[0]?.detail || "PayMongo could not create a checkout session.");
        checkoutId = data.data.id;
        checkoutUrl = data.data.attributes.checkout_url;
        db.prepare("UPDATE orders SET paymongo_checkout_id=?,paymongo_url=? WHERE id=?").run(checkoutId,checkoutUrl,id);
      } catch (err) {
        db.prepare("UPDATE orders SET payment_status='Failed',notes=? WHERE id=?").run(String(err.message).slice(0,300),id);
        return res.status(502).json({error:"Could not start GCash checkout. Check PayMongo configuration, then try again. Your order is saved for admin review.",orderId:id});
      }
    }
    res.status(201).json({orderId:id,paymentMethod,paymentStatus,subtotal,checkoutUrl,message:paymentMethod==="gcash"?"Continue to the secure PayMongo checkout to pay by GCash.":"Order received. The seller will confirm your COD order."});
  } catch (err) {
    console.error("Order create error:",err.message);
    res.status(500).json({error:"Unable to create order right now."});
  }
});

app.get("/api/admin/session",(req,res)=>res.json({authenticated:!!(req.session&&req.session.isAdmin)}));
app.post("/api/admin/login",rateLimit({windowMs:15*60*1000,limit:10,standardHeaders:true,legacyHeaders:false}), (req,res)=>{
  const {username,password}=req.body||{};
  const expectedUser=process.env.ADMIN_USERNAME, expectedPass=process.env.ADMIN_PASSWORD;
  if (!expectedUser || !expectedPass || expectedPass==="replace-with-a-unique-long-password") return res.status(503).json({error:"Set ADMIN_USERNAME and a unique ADMIN_PASSWORD in .env before using admin login."});
  if (!safeEqual(username||"",expectedUser) || !safeEqual(password||"",expectedPass)) return res.status(401).json({error:"Incorrect username or password."});
  req.session.regenerate(err=>{if(err)return res.status(500).json({error:"Could not start admin session."});req.session.isAdmin=true;res.json({ok:true})});
});
app.post("/api/admin/logout",adminOnly,(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get("/api/admin/orders",adminOnly,(req,res)=>{
  const rows=db.prepare("SELECT * FROM orders ORDER BY created_at DESC").all().map(row=>({...row,items:JSON.parse(row.items_json)}));
  res.json(rows);
});
app.patch("/api/admin/orders/:id",adminOnly,(req,res)=>{
  const {orderStatus,paymentStatus,notes}=req.body||{};
  if (orderStatus!==undefined && !orderStatuses.includes(orderStatus)) return res.status(400).json({error:"Invalid order status."});
  if (paymentStatus!==undefined && !paymentStatuses.includes(paymentStatus)) return res.status(400).json({error:"Invalid payment status."});
  if (notes!==undefined && (typeof notes!=="string"||notes.length>1000)) return res.status(400).json({error:"Notes must be under 1000 characters."});
  const existing=db.prepare("SELECT id FROM orders WHERE id=?").get(req.params.id);
  if(!existing)return res.status(404).json({error:"Order not found."});
  db.prepare("UPDATE orders SET order_status=COALESCE(?,order_status),payment_status=COALESCE(?,payment_status),notes=COALESCE(?,notes) WHERE id=?")
    .run(orderStatus??null,paymentStatus??null,notes??null,req.params.id);
  res.json({ok:true});
});

app.get("/admin",(req,res)=>res.sendFile(path.join(__dirname,"public","admin.html")));
app.get("/payment-success.html",(req,res)=>res.sendFile(path.join(__dirname,"public","payment-success.html")));
app.get("/payment-cancelled.html",(req,res)=>res.sendFile(path.join(__dirname,"public","payment-cancelled.html")));

app.listen(PORT,()=>console.log(`PinoyCart running at ${BASE_URL} (port ${PORT})`));
