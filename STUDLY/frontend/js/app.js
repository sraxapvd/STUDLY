const API='/api';

const token=()=>sessionStorage.getItem('studly_token');


/* =========================
   API
========================= */

async function api(path,opts={}){

  const headers=opts.headers||{};

  if(token()){
    headers.Authorization='Bearer '+token();
  }

  if(
    opts.body &&
    !(opts.body instanceof FormData)
  ){
    headers['Content-Type']='application/json';
  }

  const r=await fetch(
    API+path,
    {
      ...opts,
      headers
    }
  );

  let d={};

  try{
    d=await r.json();
  }catch{}

  if(!r.ok){

    throw new Error(
      d.error || 'เกิดข้อผิดพลาด'
    );

  }

  return d;
}


/* =========================
   TOAST
========================= */

function toast(msg,ok=false){

  const el=
    document.getElementById('toast');

  if(el){

    el.textContent=msg;

    el.style.color=
      ok
        ? '#16a34a'
        : '#dc2626';

    setTimeout(
      ()=>el.textContent='',
      3500
    );

  }

}


/* =========================
   LOGIN
========================= */

async function login(e){

  e.preventDefault();

  try{

    const d=await api(
      '/auth/login',
      {
        method:'POST',

        body:JSON.stringify({

          email:
            document.getElementById(
              'email'
            ).value,

          password:
            document.getElementById(
              'password'
            ).value

        })
      }
    );


    sessionStorage.setItem(
      'studly_token',
      d.token
    );


    location.href=
      d.user.role==='student'
        ? 'student.html'
        : 'teacher.html';


  }catch(err){

    toast(err.message);

  }

}


/* =========================
   LOGIN FORM
========================= */

const loginForm=
  document.getElementById(
    'loginForm'
  );

if(loginForm){

  loginForm.addEventListener(
    'submit',
    login
  );

}


/* =========================
   SHOW PASSWORD
========================= */

const showPassword=
  document.getElementById(
    'showPassword'
  );

const passwordInput=
  document.getElementById(
    'password'
  );


if(
  showPassword &&
  passwordInput
){

  showPassword.addEventListener(
    'change',
    function(){

      if(this.checked){

        passwordInput.type='text';

      }else{

        passwordInput.type='password';

      }

    }
  );

}


/* =========================
   GUARD
========================= */

async function guard(role){

  try{

    const d=await api('/me');

    if(d.user.role!==role){

      location.href=
        d.user.role==='student'
          ? 'student.html'
          : 'teacher.html';

      return null;

    }

    return d.user;

  }catch(e){

    location.href='index.html';

    return null;

  }

}


/* =========================
   LOGOUT
========================= */

async function logout(){

  await api(
    '/auth/logout',
    {
      method:'POST'
    }
  ).catch(()=>{});


  sessionStorage.removeItem(
    'studly_token'
  );


  location.href='index.html';

}


/* =========================
   ESCAPE HTML
========================= */

function esc(x){

  return String(x??'')
    .replace(
      /[&<>'"]/g,

      c=>({

        '&':'&amp;',
        '<':'&lt;',
        '>':'&gt;',
        "'":'&#39;',
        '"':'&quot;'

      }[c])

    );

}


/* =========================
   STATUS BADGE
========================= */

function statusBadge(s){

  const m={

    GRADED:[
      '🟢 ตรวจและให้คะแนนเรียบร้อย',
      'b-green'
    ],

    SUBMITTED:[
      '🔵 ส่งแล้ว รออาจารย์ตรวจ',
      'b-blue'
    ],

    NOT_SUBMITTED:[
      '⚪ ยังไม่ได้ส่ง',
      'b-gray'
    ],

    OVERDUE:[
      '🔴 เลยกำหนด',
      'b-red'
    ],

    NOT_RECEIVED:[
      '⚫ ไม่ได้รับงาน',
      'b-gray'
    ]

  };


  const x=
    m[s] ||
    [
      s,
      'b-gray'
    ];


  return `
    <span class="badge ${x[1]}">
      ${x[0]}
    </span>
  `;

}


/* =========================
   FILE
========================= */

async function fileBlob(url){

  const r=await fetch(
    url,
    {
      headers:{
        Authorization:
          'Bearer '+token()
      }
    }
  );


  if(!r.ok){

    let d={};

    try{
      d=await r.json();
    }catch{}


    throw new Error(
      d.error ||
      'เปิดไฟล์ไม่สำเร็จ'
    );

  }


  return {

    blob:await r.blob(),

    disposition:
      r.headers.get(
        'Content-Disposition'
      ) || ''

  };

}


function fileNameFromDisposition(d){

  const m=
    d.match(
      /filename\*=UTF-8''([^;]+)/i
    );


  return m
    ? decodeURIComponent(m[1])
    : 'file';

}


async function openFile(url){

  if(!url)return;


  const w=
    window.open(
      'about:blank',
      '_blank'
    );


  try{

    const x=
      await fileBlob(url);


    const u=
      URL.createObjectURL(
        x.blob
      );


    if(w){

      w.location=u;

    }else{

      window.location=u;

    }


    setTimeout(
      ()=>URL.revokeObjectURL(u),
      60000
    );


  }catch(e){

    if(w)w.close();

    toast(e.message);

  }

}


async function downloadFile(url){

  try{

    const x=
      await fileBlob(url);


    const u=
      URL.createObjectURL(
        x.blob
      );


    const a=
      document.createElement('a');


    a.href=u;


    a.download=
      fileNameFromDisposition(
        x.disposition
      );


    document.body.appendChild(a);


    a.click();


    a.remove();


    setTimeout(
      ()=>URL.revokeObjectURL(u),
      1000
    );


  }catch(e){

    toast(e.message);

  }

}


/* =========================
   SHELL
========================= */

function shell(user,role){

  document.getElementById(
    'app'
  ).innerHTML=`

    <div class="shell">

      <aside class="sidebar">

        <div class="brand">

          STUDLY

          <small>
            Your AI Study Buddy
          </small>

        </div>


        <div
          class="nav"
          id="nav"
        ></div>

      </aside>


      <main class="main">

        <div class="topbar">

          <div>

            <h2 id="pageTitle">
              Dashboard
            </h2>

            <div class="muted">
              AI Early Warning & Learning Support System
            </div>

          </div>


          <div class="user-pill">

            ${esc(user.name)}

            ·

            ${
              role==='student'
                ? 'นักเรียน'
                : 'ครู'
            }


            <button
              class="btn gray"
              onclick="logout()"
            >
              ออกจากระบบ
            </button>

          </div>

        </div>


        <div id="content"></div>

      </main>

    </div>

  `;


  /* =========================
     SIDEBAR TOGGLE
  ========================= */

  const toggle=
    document.getElementById(
      'menuToggle'
    );


  const overlay=
    document.getElementById(
      'sidebarOverlay'
    );


  if(toggle){

    toggle.onclick=()=>{

      document.body.classList.toggle(
        'sidebar-open'
      );


      const opened=
        document.body.classList.contains(
          'sidebar-open'
        );


      toggle.textContent=
        opened
          ? '✕'
          : '☰';

    };

  }


  if(overlay){

    overlay.onclick=()=>{

      document.body.classList.remove(
        'sidebar-open'
      );


      if(toggle){

        toggle.textContent='☰';

      }

    };

  }


  /* =========================
     CLOSE SIDEBAR
  ========================= */

  const nav=
    document.getElementById(
      'nav'
    );


  if(nav){

    nav.addEventListener(
      'click',
      event=>{

        if(
          window.innerWidth<=900 &&
          event.target.closest('button')
        ){

          document.body.classList.remove(
            'sidebar-open'
          );


          if(toggle){

            toggle.textContent='☰';

          }

        }

      }
    );

  }

}


/* =========================
   RESPONSIVE SIDEBAR
========================= */

window.addEventListener(
  'resize',
  ()=>{

    const toggle=
      document.getElementById(
        'menuToggle'
      );


    if(
      window.innerWidth>900
    ){

      document.body.classList.remove(
        'sidebar-open'
      );


      if(toggle){

        toggle.textContent='☰';

      }

    }

  }
);


/* =========================
   EXPORT
========================= */

window.api=api;

window.guard=guard;

window.logout=logout;

window.toast=toast;

window.esc=esc;

window.statusBadge=statusBadge;

window.shell=shell;

window.openFile=openFile;

window.downloadFile=downloadFile;
