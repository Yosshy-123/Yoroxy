/* The home page and the deliberately slow page. */
import { page, send } from '../http-helpers.mjs';

const HOME_BODY = `
  <h1>Target Home</h1>
  <a id="blank" href="/p2" target="_blank">blank</a><br>
  <a id="named" href="/p3" target="foo">named</a><br>
  <a id="self" href="/p2">self</a><br>
  <a id="hash" href="#sec">hash</a><br>
  <a id="dl" href="/file.txt" download>download</a><br>
  <a id="mailto" href="mailto:a@b.c" target="_blank">mailto</a><br>
  <a id="top" href="/p2" target="_top">top</a><br>
  <a id="onclick" href="/p2" target="_blank" onclick="window.open(this.href); return false">onclick</a><br>
  <a id="ext" href="/p2" target="_blank" rel="noopener noreferrer">noopener</a><br>
  <button id="open" onclick="window.open('/p2','_blank','width=400,height=300')">open</button>
  <button id="open-ret" onclick="var w=window.open('/p2'); window.__ret = (w===null?'null':(typeof w)); window.__w = w;">open-ret</button>
  <button id="open-blank" onclick="var w=window.open(''); window.__ret=(w===null?'null':(typeof w)); window.__w=w;">open-blank</button>
  <button id="open-named" onclick="window.open('/p3','bar')">open-named</button>
  <button id="timer" onclick="setTimeout(()=>{window.open('/p2')}, 50)">timer</button>
  <button id="spawn" onclick="for(let i=0;i<50;i++)window.open('/p2')">spawn</button>
  <button id="dyn" onclick="var a=document.createElement('a');a.href='/p2';a.target='_blank';a.textContent='dyn';a.id='dynlink';document.body.appendChild(a)">make dyn</button>
  <button id="dyn-inner" onclick="document.getElementById('box').innerHTML='<a id=&quot;innerlink&quot; href=&quot;/p2&quot; target=&quot;_blank&quot;>inner</a>'">make inner</button>
  <div id="box"></div>
  <form id="fget" action="/search" method="get" target="_blank"><input name="q" value="hello world"><button id="fget-btn">go</button></form>
  <form id="fpost" action="/post" method="post" target="_blank"><input name="a" value="1"><button id="fpost-btn">post</button></form>
  <form id="fself" action="/search" method="get"><input name="q" value="selfq"><button id="fself-btn">go</button></form>
  <form id="fprog" action="/search" method="get" target="_blank"><input name="q" value="prog"></form>
  <button id="fprog-btn" onclick="document.getElementById('fprog').submit()">prog submit</button>
  <iframe name="inner" src="/inner" id="innerframe" style="width:300px;height:80px"></iframe>
  <a id="toframe" href="/p2" target="inner">to frame</a>
  <div style="height:1500px"></div><h2 id="sec">Section</h2>`;

export function handleHome(res) {
  send(res, 200, page('Target Home', HOME_BODY, '<link rel="icon" href="/icon.png">'));
}

export function handleSlow(res, query) {
  const ms = Math.min(Number(query.get('ms')) || 3000, 30000);
  const timer = setTimeout(() => {
    send(res, 200, page('Slow Page', `<h1>Slow Page</h1><p id="waited">${ms}</p>`));
  }, ms);
  res.on('close', () => clearTimeout(timer));
}
