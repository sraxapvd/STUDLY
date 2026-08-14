const express=require('express');
const multer=require('multer');
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const {parse}=require('csv-parse/sync');
const store=require('../store');
const {calculateAssignmentStatus,calculatePriority,riskFrom}=require('../logic');
const router=express.Router();
const storage=multer.diskStorage({destination:path.join(__dirname,'..','uploads'),filename:(req,file,cb)=>{const ext=path.extname(file.originalname||'').toLowerCase();cb(null,crypto.randomBytes(16).toString('hex')+ext);}});
const upload=multer({storage});
const sessions=new Map();
const sessionUser=req=>sessions.get((req.headers.authorization||'').replace('Bearer ',''));
function auth(req,res,next){const u=sessionUser(req);if(!u)return res.status(401).json({error:'กรุณาเข้าสู่ระบบ'});req.user=u;next();}
function role(r){return (req,res,next)=>{if(req.user.role!==r)return res.status(403).json({error:'ไม่มีสิทธิ์เข้าถึงหน้านี้'});next();};}
router.post('/auth/login',(req,res)=>{const {email,password}=req.body||{};const db=store.read();const u=db.users.find(x=>x.email===email&&x.password===password);if(!u)return res.status(401).json({error:'Email หรือ Password ไม่ถูกต้อง'});const token=crypto.randomBytes(24).toString('hex');sessions.set(token,u);res.json({token,user:{...u,password:undefined}});});
router.post('/auth/logout',auth,(req,res)=>{sessions.delete((req.headers.authorization||'').replace('Bearer ',''));res.json({ok:true});});
router.get('/me',auth,(req,res)=>res.json({user:req.user}));
router.get('/student/dashboard',auth,role('student'),(req,res)=>{const db=store.read();const as=db.assignments.filter(a=>a.assignedStudents.includes(req.user.id));const subs=db.submissions.filter(s=>s.studentId===req.user.id);const statuses=as.map(a=>calculateAssignmentStatus(a,subs.find(s=>s.assignmentId===a.id)));const near=as.filter(a=>{const h=(new Date(a.deadline)-new Date())/36e5;return h>=0&&h<=72;}).length;const overdue=statuses.filter(s=>s==='OVERDUE').length;const risks=db.subjects.map(s=>({...s,risk:riskFrom(s,as,subs,db.scores)}));res.json({assignments:as,submissions:subs,statuses,summary:{average:68,required:as.length,near,overdue,risk:risks.some(x=>x.risk==='HIGH')?'HIGH':risks.some(x=>x.risk==='MEDIUM')?'MEDIUM':'LOW'},subjects:risks});});
function fileRecord(db,filename){
  const name=path.basename(filename);
  for(const a of db.assignments||[]){
    if(a.attachment?.url && path.basename(a.attachment.url)===name) return {type:'assignment',record:a,file:a.attachment};
  }
  for(const s of db.submissions||[]){
    const u=s.file||s.evidence;
    if(u && path.basename(u)===name) return {type:'submission',record:s,file:{url:u,originalName:s.originalName||'ไฟล์ที่ส่ง',mimeType:s.mimeType||'application/octet-stream'}};
  }
  return null;
}
router.get('/files/:filename',auth,(req,res)=>{
  const db=store.read();
  const rec=fileRecord(db,req.params.filename);
  if(!rec)return res.status(404).json({error:'ไม่พบไฟล์'});
  if(rec.type==='assignment'){
    const allowed=req.user.role==='teacher' || rec.record.assignedStudents?.includes(req.user.id);
    if(!allowed)return res.status(403).json({error:'ไม่มีสิทธิ์ดูไฟล์นี้'});
  }else{
    const allowed=req.user.role==='teacher' || rec.record.studentId===req.user.id;
    if(!allowed)return res.status(403).json({error:'ไม่มีสิทธิ์ดูไฟล์นี้'});
  }
  const diskPath=path.join(__dirname,'..','uploads',path.basename(rec.file.url));
  if(!fs.existsSync(diskPath))return res.status(404).json({error:'ไม่พบไฟล์บนเซิร์ฟเวอร์ อาจหายหลังจาก Deploy ใหม่'});
  res.setHeader('Content-Type',rec.file.mimeType||'application/octet-stream');
  const original=encodeURIComponent(rec.file.originalName||'file');
  if(req.query.download==='1')res.setHeader('Content-Disposition',`attachment; filename*=UTF-8''${original}`);
  else res.setHeader('Content-Disposition',`inline; filename*=UTF-8''${original}`);
  res.sendFile(diskPath);
});
router.get('/assignments',auth,(req,res)=>{const db=store.read();let as=req.user.role==='student'?db.assignments.filter(a=>a.assignedStudents.includes(req.user.id)):db.assignments;res.json({assignments:as.map(a=>({...a,attachment:a.attachment?{...a.attachment,url:'/api/files/'+path.basename(a.attachment.url)}:a.attachment,status:calculateAssignmentStatus(a,db.submissions.find(s=>s.assignmentId===a.id&&s.studentId===req.user.id))}))});});
router.post('/assignments',auth,role('teacher'),(req,res)=>{const a={...req.body,id:'a-'+Date.now(),assignedStudents:req.body.assignedStudents||['stu-001']};if(a.type==='Offline')a.offlineCode=String(Math.floor(100000+Math.random()*900000));store.update(db=>{db.assignments.push(a);return db;});res.json({assignment:a});});
router.post('/assignments/:id/file',auth,role('teacher'),upload.single('file'),(req,res)=>{
  if(!req.file)return res.status(400).json({error:'กรุณาเลือกไฟล์'});
  const out=store.update(db=>{
    const a=db.assignments.find(x=>x.id===req.params.id);
    if(!a)return null;
    a.attachment={url:'/api/files/'+req.file.filename,originalName:req.file.originalname,mimeType:req.file.mimetype,size:req.file.size};
    return a;
  });
  if(!out)return res.status(404).json({error:'ไม่พบ Assignment'});
  res.json({assignment:out});
});
router.put('/assignments/:id',auth,role('teacher'),(req,res)=>{const out=store.update(db=>{const i=db.assignments.findIndex(a=>a.id===req.params.id);if(i<0)return null;db.assignments[i]={...db.assignments[i],...req.body};return db.assignments[i];});if(!out)return res.status(404).json({error:'ไม่พบ Assignment'});res.json({assignment:out});});
router.delete('/assignments/:id',auth,role('teacher'),(req,res)=>{store.update(db=>{db.assignments=db.assignments.filter(a=>a.id!==req.params.id);db.submissions=db.submissions.filter(s=>s.assignmentId!==req.params.id);return db;});res.json({ok:true});});
router.post('/submissions/online',auth,role('student'),upload.single('file'),(req,res)=>{const db=store.read();const a=db.assignments.find(x=>x.id===req.body.assignmentId&&x.assignedStudents.includes(req.user.id));if(!a)return res.status(400).json({error:'คุณไม่ได้รับมอบหมายงานนี้'});const s={id:'s-'+Date.now(),studentId:req.user.id,assignmentId:a.id,file:req.file?'/api/files/'+req.file.filename:null,originalName:req.file?.originalname||null,mimeType:req.file?.mimetype||null,submittedAt:new Date().toISOString(),status:'SUBMITTED',teacherVerified:false};store.update(d=>{d.submissions.push(s);return d;});res.json({submission:s});});
router.post('/submissions/offline',auth,role('student'),upload.single('evidence'),(req,res)=>{const db=store.read();const a=db.assignments.find(x=>x.id===req.body.assignmentId&&x.assignedStudents.includes(req.user.id));if(!a)return res.status(400).json({error:'คุณไม่ได้รับมอบหมายงานนี้'});if(!/^\d{6}$/.test(req.body.code||''))return res.status(400).json({error:'กรุณากรอกรหัส Assignment 6 หลัก'});if(req.body.code!==a.offlineCode)return res.status(400).json({error:'รหัส Assignment ไม่ถูกต้อง'});const s={id:'s-'+Date.now(),studentId:req.user.id,assignmentId:a.id,code:req.body.code,evidence:req.file?'/api/files/'+req.file.filename:null,originalName:req.file?.originalname||null,mimeType:req.file?.mimetype||null,submittedAt:new Date().toISOString(),status:'SUBMITTED',teacherVerified:false};store.update(d=>{d.submissions.push(s);return d;});res.json({submission:s});});
router.get('/submissions',auth,role('teacher'),(req,res)=>{const db=store.read();res.json({submissions:db.submissions.map(s=>({...s,file:s.file?'/api/files/'+path.basename(s.file):s.file,evidence:s.evidence?'/api/files/'+path.basename(s.evidence):s.evidence})),assignments:db.assignments.map(a=>({...a,attachment:a.attachment?{...a.attachment,url:'/api/files/'+path.basename(a.attachment.url)}:a.attachment})),students:db.users.filter(u=>u.role==='student')});});
router.post('/submissions/:id/grade',auth,role('teacher'),(req,res)=>{const {score,comment}=req.body;const out=store.update(db=>{const s=db.submissions.find(x=>x.id===req.params.id);if(!s)return null;s.teacherVerified=true;s.score=Number(score);s.comment=comment||'';s.status='GRADED';db.scores.push({studentId:s.studentId,assignmentId:s.assignmentId,score:Number(score),createdAt:new Date().toISOString()});return s;});if(!out)return res.status(404).json({error:'ไม่พบ Submission'});res.json({submission:out});});
router.post('/submissions/:id/reject',auth,role('teacher'),(req,res)=>{const out=store.update(db=>{const s=db.submissions.find(x=>x.id===req.params.id);if(!s)return null;s.teacherVerified=true;s.status='NOT_RECEIVED';s.rejectedAt=new Date().toISOString();return s;});if(!out)return res.status(404).json({error:'ไม่พบ Submission'});res.json({submission:out});});
router.post('/scores/import',auth,role('teacher'),upload.single('file'),(req,res)=>{if(!req.file)return res.status(400).json({error:'กรุณาเลือก CSV'});const text=fs.readFileSync(req.file.path,'utf8');let rows;try{rows=parse(text,{columns:true,skip_empty_lines:true,trim:true});}catch(e){return res.status(400).json({error:'CSV ไม่ถูกต้อง'});}const result=store.update(db=>{let count=0;for(const r of rows){const student=db.users.find(u=>u.email===r.student_email);const a=db.assignments.find(x=>x.title===r.assignment&&x.subject===r.subject);if(student&&a){db.scores.push({id:'imp-'+Date.now()+'-'+count,studentId:student.id,assignmentId:a.id,score:Number(r.score),maxScore:Number(r.max_score||a.maxScore),createdAt:new Date().toISOString(),source:'CSV'});count++;}}return count;});res.json({imported:result});});
router.get('/ai/student',auth,role('student'),(req,res)=>{const db=store.read();const as=db.assignments.filter(a=>a.assignedStudents.includes(req.user.id));const subs=db.submissions.filter(s=>s.studentId===req.user.id);const items=as.map(a=>{const subject=db.subjects.find(s=>s.name===a.subject)||{name:a.subject,score:70};const status=calculateAssignmentStatus(a,subs.find(s=>s.assignmentId===a.id));return {...a,status,priority:calculatePriority(a,subject,status),risk:riskFrom(subject,as,subs,db.scores)};}).filter(x=>x.status!=='GRADED').sort((a,b)=>b.priority.score-a.priority.score);res.json({items,generatedAt:new Date().toISOString()});});
router.get('/ai/teacher',auth,role('teacher'),(req,res)=>{const db=store.read();const as=db.assignments;const subs=db.submissions;const students=db.users.filter(u=>u.role==='student').map(st=>{const risks=db.subjects.map(s=>({subject:s.name,risk:riskFrom(s,as.filter(a=>a.assignedStudents.includes(st.id)),subs.filter(x=>x.studentId===st.id),db.scores)}));const high=risks.filter(r=>r.risk==='HIGH');return {...st,risks,atRisk:high.length>0,recommendation:high.length?'ควรติดตามและช่วยจัดลำดับงานที่มีความเสี่ยงสูง':'ติดตามตามปกติ'};});res.json({students});});
router.get('/notification-settings',auth,(req,res)=>{
  const db=store.read();
  const u=db.users.find(x=>x.id===req.user.id);
  const defaults=u?.role==='teacher'
    ? {newSubmission:true,pendingReview:true,studentRiskHigh:true,assignmentDeadline:true}
    : {newAssignment:true,deadlineNear:true,overdue:true,aiRecommendation:true,teacherGraded:true};
  res.json({settings:{...defaults,...(u?.notificationSettings||{})}});
});
router.put('/notification-settings',auth,(req,res)=>{
  const db=store.read();
  const u=db.users.find(x=>x.id===req.user.id);
  if(!u)return res.status(404).json({error:'ไม่พบผู้ใช้'});
  u.notificationSettings={...(u.notificationSettings||{}),...(req.body||{})};
  store.write(db);
  res.json({settings:u.notificationSettings});
});
router.get('/notifications',auth,(req,res)=>{const db=store.read();res.json({notifications:db.notifications.filter(n=>n.userId===req.user.id)});});
router.get('/profile',auth,(req,res)=>res.json({user:req.user,connected:!!dbLine(req.user.id)}));
function dbLine(id){const db=store.read();return db.parentConnections.find(x=>x.studentId===id&&x.status==='CONNECTED');}
router.post('/parent/link-code',auth,role('student'),(req,res)=>{const code='STU-'+String(Math.floor(100000+Math.random()*900000));const expiresAt=new Date(Date.now()+10*60*1000).toISOString();store.update(db=>{db.linkCodes.push({code,studentId:req.user.id,createdAt:new Date().toISOString(),expiresAt,used:false});return db;});res.json({code,expiresAt});});
router.post('/parent/disconnect',auth,role('student'),(req,res)=>{store.update(db=>{db.parentConnections=db.parentConnections.filter(x=>x.studentId!==req.user.id);return db;});res.json({ok:true});});
router.get('/parent/status',auth,role('student'),(req,res)=>{const db=store.read();const c=db.parentConnections.find(x=>x.studentId===req.user.id&&x.status==='CONNECTED');res.json({connected:!!c,connection:c||null});});
module.exports={router,sessions,sessionUser};
