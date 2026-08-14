# STUDLY — Your AI Study Buddy

Functional Web Prototype สำหรับ Hackathon: AI Early Warning & Learning Support System

## จุดเด่นที่ทำงานจริง
- Student / Teacher login, logout และ role protection
- Shared JSON Data Store: Teacher สร้าง/แก้ไข/ลบ Assignment แล้ว Student เห็นข้อมูลชุดเดียวกัน
- Online Assignment: upload PDF/DOC/DOCX/JPG/PNG และ submit
- Offline Assignment: 6-digit code required + evidence optional + Teacher verification/reject
- Assignment status engine: GRADED / SUBMITTED / NOT_SUBMITTED / OVERDUE / NOT_RECEIVED
- AI Priority Planner, AI Risk และ Teacher AI Insights จากข้อมูล Assignment จริง
- CSV score import ทำงานจริง
- Google Sheets แสดงเป็น Demo / Integration Ready จนกว่าจะใส่ Google API credential จริง
- LINE Messaging API ผ่าน Backend เท่านั้น
- LINE Webhook + one-time Link Code + Parent Confirmation
- LINE Test Message และ Smart Alert endpoint

## ติดตั้ง
ต้องใช้ Node.js 18+.

```bash
npm install
copy .env.example .env
npm start
```

เปิด `http://localhost:3000`

## LINE Developers
1. สร้าง LINE Official Account และ Messaging API channel ใน LINE Developers
2. นำ Channel Access Token และ Channel Secret ใส่ `.env`:

```env
LINE_CHANNEL_ACCESS_TOKEN=...
LINE_CHANNEL_SECRET=...
```

3. Deploy backend ให้มี HTTPS public URL เช่น `https://your-domain.example`
4. ตั้ง Webhook URL เป็น:
`https://your-domain.example/api/line/webhook`
5. เปิด Use webhook ใน LINE Developers
6. เพิ่ม STUDLY Official Account จาก LINE แล้วใช้ Link Code จาก Student Profile ส่งเข้าแชต
7. Backend จะตรวจ code และส่ง Parent Confirmation ผ่าน LINE

**Security:** `.env` ไม่ถูกเสิร์ฟโดย frontend, ไม่เก็บ token ใน localStorage/sessionStorage และไม่ส่ง token กลับผ่าน API

## ทดสอบ Student
- Email: `student@demo.ac.th`
- Password: `studentdemo`

## ทดสอบ Teacher
- Email: `teacher@demo.ac.th`
- Password: `teacherdemo`

## Online Demo
Teacher → Assignments → สร้าง Online → Student → งานของฉัน → เปิดงาน → Upload → Confirm Submission → Teacher → ตรวจงาน → ให้คะแนน → Student refresh

## Offline Demo
Teacher → สร้าง Offline → ระบบ generate code 6 หลัก → Student กรอก code → Evidence optional → Confirm Submission → Teacher ตรวจ → ให้คะแนน หรือ Reject

## Reject Logic
ถ้า Reject ระบบจะคำนวณกลับเป็น `ยังไม่ได้ส่ง` หาก deadline ยังไม่ถึง หรือ `เลยกำหนด` หาก deadline ผ่านแล้ว

## AI
Priority ใช้ Deadline, คะแนนเต็ม, weight, current score, difficulty, estimated time และ status เพื่อจัด HIGH/MEDIUM/LOW พร้อมเหตุผล
Risk ใช้ Current Score + pending/overdue + deadline proximity + submission history

## CSV
ตัวอย่าง header:
`student_email,subject,assignment,score,max_score`

## หมายเหตุสำคัญ
LINE Messaging API จะส่งข้อความจริงได้เมื่อ `.env` มี credential ที่ถูกต้องและ parent connection มี `lineUserId` ที่ได้รับจาก LINE webhook เท่านั้น หากไม่มี credential ระบบจะแจ้ง error และไม่อ้างว่าส่งจริง


## Prototype update — Assignment Files & Notification Settings

- ครูสามารถแนบไฟล์โจทย์/เอกสารประกอบตอนสร้างหรือแก้ไข Assignment
- นักเรียนเปิด/ดาวน์โหลดไฟล์โจทย์จากหน้า Assignment ได้
- ครูเปิด/ดาวน์โหลดไฟล์ที่นักเรียนส่งจากหน้า ตรวจงาน ได้
- นักเรียนเปิด/ดาวน์โหลดไฟล์ที่ตัวเองส่งจากหน้า ดูผล ได้
- ฝั่งครูแสดงคะแนนเต็มของแต่ละ Submission ชัดเจน
- เพิ่มสวิตช์เปิด/ปิดการแจ้งเตือนทั้ง Student และ Teacher พร้อมบันทึกค่าใน Shared Data Store
- Session ใช้ sessionStorage เพื่อแยก Student/Teacher คนละแท็บใน Browser เดียวกัน
