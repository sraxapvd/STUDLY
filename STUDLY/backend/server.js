require('dotenv').config();const express=require('express');const path=require('path');const fs=require('fs');const app=express();
app.use(express.json({verify:(req,res,buf)=>{req.rawBody=Buffer.from(buf);}}));app.use(express.urlencoded({extended:true}));
app.use('/uploads',express.static(path.join(__dirname,'uploads')));app.use('/api',require('./routes/api').router);app.use('/api/line',require('./routes/line').router);
app.use(express.static(path.join(__dirname,'..','frontend')));
app.get('*',(req,res)=>{if(req.path.startsWith('/api'))return res.status(404).json({error:'Not found'});res.sendFile(path.join(__dirname,'..','frontend','index.html'));});
const port=process.env.PORT||3000;app.listen(port,()=>console.log(`STUDLY running at http://localhost:${port}`));
