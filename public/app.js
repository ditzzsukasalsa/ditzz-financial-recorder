"use strict";
const $ = id => document.getElementById(id);
const money = n => new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",maximumFractionDigits:0}).format(n || 0);
const today = () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };
const monthNow = () => today().slice(0,7);
let transactions = [], wishlist = [], currentUser = null, toastTimer, transactionsLoaded = false, wishlistLoaded = false, activeWishlistFundId = null, wishlistImageData = "";
const categories = {
  income:["Gaji","Bisnis","Freelance","Investasi","Hadiah","Lainnya"],
  expense:["Makanan","Transportasi","Belanja","Tagihan","Hiburan","Kesehatan","Pendidikan","Bisnis","Lainnya"]
};
async function api(url, options={}) {
  const res = await fetch(url,{credentials:"same-origin",headers:{"Content-Type":"application/json",...(options.headers||{})},...options});
  const data = await res.json().catch(()=>({message:"Respons server tidak valid."}));
  if(!res.ok) throw new Error(data.message || "Terjadi kesalahan.");
  return data;
}
function toast(message,error=false){const el=$("toast");el.textContent=message;el.className="toast show"+(error?" error":"");clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.className="toast",2800)}
function showLogin(){ $("loginView").classList.remove("hidden");$("appView").classList.add("hidden"); }
function showApp(){ $("loginView").classList.add("hidden");$("appView").classList.remove("hidden");$("userName").textContent=currentUser.name||currentUser.username.toUpperCase();$("settingUsername").value=currentUser.username;$("settingName").value=currentUser.name||"";loadTransactions();loadWishlist();loadPushSettings(); }
async function refreshSession(){try{const d=await api("/api/me");currentUser=d.user;showApp()}catch{showLogin()}}
function showDashboardSkeleton(){
 ["balance","income","expense","dailyAverage","savingRate","transactionCount"].forEach(id=>{const el=$(id);if(el)el.innerHTML='<span class="skeleton skeleton-value"></span>'});
 ["savingRateHint","transactionCountHint"].forEach(id=>{const el=$(id);if(el)el.innerHTML='<span class="skeleton skeleton-line"></span>'});
 $("recentRows").innerHTML=Array.from({length:4},()=>'<tr class="skeleton-row"><td colspan="5"><span class="skeleton skeleton-line"></span></td></tr>').join("");
 $("categorySummary").innerHTML=Array.from({length:4},()=>'<div class="skeleton-item"><span class="skeleton skeleton-line"></span><span class="skeleton skeleton-line short"></span></div>').join("");
 $("chartArea").innerHTML='<div class="chart-skeleton">'+Array.from({length:6},(_,i)=>`<span class="skeleton" style="height:${28+i%3*17}%"></span>`).join("")+'</div>';
 $("page-dashboard")?.setAttribute("aria-busy","true");
}
async function loadTransactions(){if(!transactionsLoaded)showDashboardSkeleton();try{const d=await api("/api/transactions");transactions=d.transactions;transactionsLoaded=true;renderAll();$("page-dashboard")?.setAttribute("aria-busy","false");if($("page-calendar")&&!$("page-calendar").classList.contains("hidden"))renderCalendar();if($("page-insights")&&!$("page-insights").classList.contains("hidden"))renderInsights()}catch(e){if(!transactionsLoaded){transactionsLoaded=true;renderAll();$("page-dashboard")?.setAttribute("aria-busy","false")}toast(e.message,true)}}
function sum(type,rows=transactions){return rows.filter(t=>t.type===type).reduce((s,t)=>s+t.amount,0)}
function renderAll(){renderDashboard();renderTransactions();renderReport()}
function txMarkup(t,withActions=false){return `<tr><td><div class="tx-name">${escapeHtml(t.title)}</div><div class="tx-sub">${escapeHtml(t.note||"Tanpa catatan")}${t.receipt?` · <a class="text-btn receipt-link" href="${t.receipt}" target="_blank" rel="noopener">Lihat bukti</a>`:""}</div></td><td>${escapeHtml(t.category)}</td><td>${formatDate(t.date)}</td><td><span class="type-tag ${t.type}">${t.type==="income"?"Pemasukan":"Pengeluaran"}</span></td><td class="align-right ${t.type==="income"?"amount-income":"amount-expense"}">${t.type==="income"?"+":"−"} ${money(t.amount)}</td>${withActions?`<td class="action-cell"><button class="icon-action" data-edit="${t.id}" title="Edit">✎</button><button class="icon-action delete" data-delete="${t.id}" title="Hapus">×</button></td>`:""}</tr>`}
function escapeHtml(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function formatDate(s){return new Date(s+"T00:00:00").toLocaleDateString("id-ID",{day:"2-digit",month:"short",year:"numeric"})}
let balanceHidden=false;
function renderDashboard(){
 const inc=sum("income"),exp=sum("expense"),walletTotal=inc-exp;$("income").textContent=money(inc);$("expense").textContent=money(exp);$("balance").textContent=balanceHidden?"••••••••":money(walletTotal);
 const month=monthNow(),monthRows=transactions.filter(t=>t.date.startsWith(month)),monthExpense=sum("expense",monthRows),monthIncome=sum("income",monthRows),days=Math.max(1,new Date().getDate());
 $("dailyAverage").textContent=money(Math.round(monthExpense/days));
 $("savingRate").textContent=(monthIncome?Math.round((monthIncome-monthExpense)/monthIncome*100):0)+"%";
 $("savingRateHint").textContent=monthIncome?"Selisih pemasukan dan pengeluaran":"Belum ada pemasukan bulan ini";
 $("transactionCount").textContent=transactions.length.toLocaleString("id-ID");
 $("transactionCountHint").textContent=monthRows.length.toLocaleString("id-ID")+" transaksi bulan ini";
 $("recentRows").innerHTML=transactions.slice(0,6).map(t=>txMarkup(t)).join("")||'<tr><td colspan="5" class="empty-small">Belum ada transaksi. Mulai catat keuanganmu.</td></tr>';
 const expenses=transactions.filter(t=>t.type==="expense"), groups={};expenses.forEach(t=>groups[t.category]=(groups[t.category]||0)+t.amount);
 const sorted=Object.entries(groups).sort((a,b)=>b[1]-a[1]).slice(0,5),max=sorted[0]?.[1]||1;
 $("categorySummary").innerHTML=sorted.map(([name,val])=>`<div class="category-item"><div class="category-line"><b>${escapeHtml(name)}</b><span>${money(val)}</span></div><div class="progress"><span style="width:${val/max*100}%"></span></div></div>`).join("")||'<div class="empty-small">Belum ada data pengeluaran.</div>';
 renderChart();
}
function renderChart(){
 const months=[];const now=new Date();for(let i=5;i>=0;i--){const d=new Date(now.getFullYear(),now.getMonth()-i,1);months.push({key:`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`,label:d.toLocaleDateString("id-ID",{month:"short"})})}
 const values=months.map(m=>({ ...m,inc:sum("income",transactions.filter(t=>t.date.startsWith(m.key))),exp:sum("expense",transactions.filter(t=>t.date.startsWith(m.key))) }));
 const max=Math.max(1,...values.flatMap(v=>[v.inc,v.exp]));
 $("chartArea").innerHTML=values.some(v=>v.inc||v.exp)?values.map(v=>`<div class="chart-group"><div class="chart-bar income-bg" style="height:${Math.max(v.inc?4:0,v.inc/max*100)}%"></div><div class="chart-bar expense-bg" style="height:${Math.max(v.exp?4:0,v.exp/max*100)}%"></div><span class="chart-month">${v.label}</span></div>`).join(""):'<div class="empty-chart">Belum ada data transaksi untuk ditampilkan.</div>';
}
function renderTransactions(){
 const q=$("searchInput").value.toLowerCase(),type=$("typeFilter").value,month=$("monthFilter").value,sort=$("sortFilter")?.value||"newest";
 const rows=transactions.filter(t=>(type==="all"||t.type===type)&&(!month||t.date.startsWith(month))&&(`${t.title} ${t.category} ${t.note}`.toLowerCase().includes(q)));
 rows.sort((a,b)=>sort==="oldest"?a.date.localeCompare(b.date):sort==="highest"?b.amount-a.amount:sort==="lowest"?a.amount-b.amount:b.date.localeCompare(a.date));
 $("transactionRows").innerHTML=rows.map(t=>txMarkup(t,true)).join("");$("tableEmpty").classList.toggle("hidden",rows.length>0);
}
function renderReport(){
 const month=$("reportMonth").value||monthNow(),rows=transactions.filter(t=>t.date.startsWith(month)),inc=sum("income",rows),exp=sum("expense",rows);
 $("reportIncome").textContent=money(inc);$("reportExpense").textContent=money(exp);$("reportNet").textContent=money(inc-exp);
 $("reportRows").innerHTML=rows.length?rows.map(t=>`<div class="report-row"><span>${escapeHtml(t.title)} · ${formatDate(t.date)}</span><b class="${t.type==="income"?"amount-income":"amount-expense"}">${t.type==="income"?"+":"−"} ${money(t.amount)}</b></div>`).join(""):'<div class="empty-small">Belum ada transaksi pada bulan ini.</div>';
}

function openModal(item=null){
 $("transactionForm").reset();$("editId").value=item?.id||"";$("modalTitle").textContent=item?"Edit transaksi":"Catatan transaksi";
 document.querySelector(`input[name="type"][value="${item?.type||"income"}"]`).checked=true;
 populateCategories(item?.type||"income",item?.category||"");$("txTitle").value=item?.title||"";$("txAmount").value=item?.amount||"";$("txDate").value=item?.date||today();$("txNote").value=item?.note||"";
 $("modal").classList.remove("hidden");
}
function closeModal(){$("modal").classList.add("hidden")}
function populateCategories(type,selected=""){$("txCategory").innerHTML='<option value="">Pilih kategori</option>'+categories[type].map(c=>`<option ${c===selected?"selected":""}>${c}</option>`).join("")}
function navigate(page){const target=$("page-"+page);if(!target)return;if(page!=="wishlist")closeWishlistCreatePanel();document.querySelectorAll(".page").forEach(p=>{p.classList.add("hidden");p.classList.remove("page-enter")});target.classList.remove("hidden");target.classList.add("page-enter");target.addEventListener("animationend",()=>target.classList.remove("page-enter"),{once:true});document.querySelectorAll(".nav-item").forEach(b=>b.classList.toggle("active",b.dataset.page===page));document.querySelectorAll(".mobile-nav-item[data-mobile-page]").forEach(b=>b.classList.toggle("active",b.dataset.mobilePage===page));$("pageTitle").textContent=({dashboard:"Dashboard",transactions:"Transaksi",reports:"Laporan",wishlist:"Wishlist",calendar:"Kalender",insights:"Analisis",settings:"Pengaturan"})[page]||"Dashboard";$("sidebar").classList.remove("open");$("sidebarScrim")?.classList.remove("show");if(page==="transactions")renderTransactions();if(page==="reports")renderReport();if(page==="wishlist")loadWishlist();if(page==="calendar")renderCalendar();if(page==="insights")renderInsights();window.scrollTo({top:0,behavior:"smooth"})}
let cameraStream=null, capturedImage=null, cameraFacingMode="environment";
function toggleQuickActions(force){
 const panel=$("quickActions"),open=force??panel.classList.contains("hidden");
 panel.classList.toggle("hidden",!open);$("mobileAdd").classList.toggle("is-open",open);
 $("mobileAdd").setAttribute("aria-expanded",String(open));
}
function closeCamera(){
 if(cameraStream){cameraStream.getTracks().forEach(t=>t.stop());cameraStream=null}
 $("cameraModal").classList.add("hidden");$("cameraVideo").srcObject=null;
}
async function startCamera(mode=cameraFacingMode){
 if(!navigator.mediaDevices?.getUserMedia)throw new Error("Kamera tidak tersedia. Gunakan HTTPS atau localhost.");
 if(cameraStream){cameraStream.getTracks().forEach(track=>track.stop());cameraStream=null}
 cameraFacingMode=mode;
 $("cameraStatus").textContent=mode==="user"?"Mengaktifkan kamera depan…":"Mengaktifkan kamera belakang…";
 const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:mode}},audio:false});
 cameraStream=stream;
 $("cameraVideo").srcObject=stream;
 await $("cameraVideo").play();
 $("cameraStatus").textContent="Arahkan kamera ke bukti transfer, lalu tekan Ambil Foto.";
}
async function openCamera(){
 toggleQuickActions(false);capturedImage=null;cameraFacingMode="environment";
 $("cameraFacing").value=cameraFacingMode;
 $("cameraFacing").disabled=false;
 $("cameraPreviewWrap").classList.add("hidden");$("cameraVideo").classList.remove("hidden");
 $("cameraCapture").classList.remove("hidden");$("cameraRetake").classList.add("hidden");$("ocrButton").classList.add("hidden");$("cameraResult").classList.add("hidden");
 $("cameraModal").classList.remove("hidden");
 try{await startCamera(cameraFacingMode)}
 catch(e){$("cameraStatus").textContent=e.message||"Tidak dapat mengakses kamera.";toast("Akses kamera gagal.",true)}
}
$("cameraFacing")?.addEventListener("change",async event=>{
 const nextMode=event.target.value;
 try{await startCamera(nextMode)}
 catch(e){$("cameraStatus").textContent=e.message||"Kamera pilihan tidak dapat digunakan.";toast("Tidak dapat mengganti kamera.",true)}
});
async function recognizeCaptured(){
 if(!capturedImage)return;
 $("ocrButton").disabled=true;$("cameraStatus").textContent="Sedang membaca teks pada gambar…";
 try{
  if(!window.Tesseract)throw new Error("Mesin OCR belum termuat. Periksa koneksi internet lalu coba lagi.");
  const result=await Tesseract.recognize(capturedImage,"eng");
  const text=result.data.text||"";
  $("ocrText").value=text;
  const amountCandidates=text.match(/(?:Rp\s*)?\d[\d.,\s]{2,}/gi)||[];
  const parsed=amountCandidates.map(v=>({raw:v,digits:v.replace(/\D/g,"")})).filter(v=>v.digits.length>=3).map(v=>({...v,value:Number(v.digits)})).filter(v=>Number.isSafeInteger(v.value)&&v.value>0);
  const amount=parsed.sort((a,b)=>b.value-a.value)[0]?.value||"";
  const dateMatch=text.match(/\b(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})\b/);
  let date=today();
  if(dateMatch){let [,dd,mm,yy]=dateMatch;yy=yy.length===2?"20"+yy:yy;const candidate=`${yy}-${mm.padStart(2,"0")}-${dd.padStart(2,"0")}`;if(!Number.isNaN(Date.parse(candidate)))date=candidate}
  $("ocrAmount").value=amount?String(amount):"";
  $("ocrDate").value=date;
  $("cameraStatus").textContent=amount?"Pembacaan selesai. Periksa nominal dan tanggal sebelum digunakan.":"Teks terbaca, tetapi nominal belum terdeteksi dengan yakin. Isi nominal secara manual.";
  $("cameraResult").classList.remove("hidden");
 }catch(e){$("cameraStatus").textContent=e.message||"OCR gagal membaca gambar."}
 finally{$("ocrButton").disabled=false}
}
$("quickNote")?.addEventListener("click",()=>{toggleQuickActions(false);openModal()});
$("quickCamera")?.addEventListener("click",openCamera);
$("cameraClose")?.addEventListener("click",closeCamera);
$("cameraCapture")?.addEventListener("click",()=>{
 const video=$("cameraVideo"),canvas=$("cameraCanvas");
 if(!video.videoWidth){toast("Kamera belum siap.",true);return}
 canvas.width=video.videoWidth;canvas.height=video.videoHeight;canvas.getContext("2d").drawImage(video,0,0);
 capturedImage=canvas.toDataURL("image/jpeg",.92);$("cameraFacing").disabled=true;$("cameraPreview").src=capturedImage;
 $("cameraPreviewWrap").classList.remove("hidden");$("cameraVideo").classList.add("hidden");
 $("cameraCapture").classList.add("hidden");$("cameraRetake").classList.remove("hidden");$("ocrButton").classList.remove("hidden");
 $("cameraStatus").textContent="Foto berhasil diambil. Tekan Baca OCR.";
});
$("cameraRetake")?.addEventListener("click",()=>{capturedImage=null;$("cameraFacing").disabled=false;$("cameraPreviewWrap").classList.add("hidden");$("cameraVideo").classList.remove("hidden");$("cameraCapture").classList.remove("hidden");$("cameraRetake").classList.add("hidden");$("ocrButton").classList.add("hidden");$("cameraResult").classList.add("hidden");$("cameraStatus").textContent="Ambil ulang foto bukti transfer."});
$("ocrButton")?.addEventListener("click",recognizeCaptured);
$("useOcrData")?.addEventListener("click",()=>{
 const amount=Number($("ocrAmount").value);
 if(!amount||amount<=0){toast("Isi nominal yang valid terlebih dahulu.",true);return}
 closeCamera();openModal();
 document.querySelector('input[name="type"][value="expense"]').checked=true;populateCategories("expense");
 $("txTitle").value="Transaksi hasil scan";$("txAmount").value=amount;$("txDate").value=$("ocrDate").value||today();$("txNote").value="Dibaca dari kamera (OCR). Periksa kembali data transaksi.";
 toast("Hasil OCR dimasukkan ke catatan. Periksa sebelum menyimpan.");
});

document.querySelectorAll(".nav-item").forEach(b=>b.addEventListener("click",()=>navigate(b.dataset.page)));
document.querySelectorAll(".mobile-nav-item[data-mobile-page]").forEach(b=>b.addEventListener("click",()=>navigate(b.dataset.mobilePage)));
$("mobileAdd")?.addEventListener("click",()=>toggleQuickActions());
$("mobileMore")?.addEventListener("click",()=>{$("sidebar").classList.add("open");$("sidebarScrim")?.classList.add("show")});
$("sidebarScrim")?.addEventListener("click",()=>{$("sidebar").classList.remove("open");$("sidebarScrim").classList.remove("show")});
$("toggleBalance")?.addEventListener("click",()=>{balanceHidden=!balanceHidden;renderDashboard();$("toggleBalance").textContent=balanceHidden?"◎":"◉";$("toggleBalance").setAttribute("aria-label",balanceHidden?"Tampilkan saldo":"Sembunyikan saldo")});
document.querySelectorAll("[data-goto]").forEach(b=>b.addEventListener("click",()=>navigate(b.dataset.goto)));
let authMode="login";
function setAuthMode(mode){authMode=mode;const registering=mode==="register";$("loginForm").classList.toggle("hidden",registering);$("registerForm").classList.toggle("hidden",!registering);$("loginHeading").innerHTML=registering?'<span class="eyebrow red">GET STARTED</span><h2>Buat akun baru</h2><p class="muted">Daftar untuk mulai mencatat keuanganmu.</p>':'<span class="eyebrow red">WELCOME BACK</span><h2>Masuk ke akun</h2><p class="muted">Kelola keuanganmu dengan lebih teratur.</p>';$("authSwitchText").textContent=registering?"Sudah punya akun?":"Belum punya akun?";$("authSwitch").textContent=registering?"Masuk":"Daftar sekarang";}
$("authSwitch").addEventListener("click",()=>setAuthMode(authMode==="login"?"register":"login"));
$("loginForm").addEventListener("submit",async e=>{e.preventDefault();try{const d=await api("/api/login",{method:"POST",body:JSON.stringify({username:$("username").value,password:$("password").value})});currentUser=d.user;showApp()}catch(err){toast(err.message,true)}});
$("registerForm").addEventListener("submit",async e=>{e.preventDefault();if($("registerPassword").value!==$("registerConfirm").value)return toast("Konfirmasi password tidak sama.",true);try{const d=await api("/api/register",{method:"POST",body:JSON.stringify({name:$("registerName").value,username:$("registerUsername").value,password:$("registerPassword").value})});currentUser=d.user;$("registerForm").reset();showApp();toast(d.message)}catch(err){toast(err.message,true)}});
$("togglePass").addEventListener("click",()=>{$("password").type=$("password").type==="password"?"text":"password";$("togglePass").textContent=$("password").type==="password"?"Lihat":"Sembunyi"});
$("logoutBtn").addEventListener("click",async()=>{try{await api("/api/logout",{method:"POST"});currentUser=null;showLogin()}catch(e){toast(e.message,true)}});
$("quickAdd").addEventListener("click",()=>openModal());$("addTransaction").addEventListener("click",()=>openModal());$("closeModal").addEventListener("click",closeModal);$("cancelModal").addEventListener("click",closeModal);
document.querySelectorAll('input[name="type"]').forEach(r=>r.addEventListener("change",()=>populateCategories(r.value)));
$("transactionForm").addEventListener("submit",async e=>{e.preventDefault();const id=$("editId").value;const payload={type:document.querySelector('input[name="type"]:checked').value,title:$("txTitle").value,amount:Number($("txAmount").value),category:$("txCategory").value,date:$("txDate").value,note:$("txNote").value};try{const saved=await api(id?"/api/transactions/"+id:"/api/transactions",{method:id?"PUT":"POST",body:JSON.stringify(payload)});closeModal();await loadTransactions();toast(id?"Transaksi diperbarui.":"Transaksi berhasil ditambahkan.")}catch(err){toast(err.message,true)}});
$("transactionRows").addEventListener("click",async e=>{const edit=e.target.closest("[data-edit]"),del=e.target.closest("[data-delete]");if(edit){const item=transactions.find(t=>t.id===edit.dataset.edit);if(item)openModal(item)}if(del&&confirm("Hapus transaksi ini? Tindakan ini tidak dapat dibatalkan.")){try{await api("/api/transactions/"+del.dataset.delete,{method:"DELETE"});await loadTransactions();toast("Transaksi dihapus.")}catch(err){toast(err.message,true)}}});
$("searchInput").addEventListener("input",renderTransactions);$("typeFilter").addEventListener("change",renderTransactions);$("monthFilter").addEventListener("change",renderTransactions);$("sortFilter").addEventListener("change",renderTransactions);$("reportMonth").value=monthNow();$("reportMonth").addEventListener("change",renderReport);

// Floating Wishlist composer, styled like the floating calculator.
function closeWishlistCreatePanel(){const panel=$("wishlistFormPanel"),trigger=$("wishlistAddTrigger");panel?.classList.remove("is-open");trigger?.setAttribute("aria-expanded","false")}
function openWishlistCreatePanel(){const panel=$("wishlistFormPanel"),trigger=$("wishlistAddTrigger");if(!panel)return;panel.classList.add("is-open");trigger?.setAttribute("aria-expanded","true");setTimeout(()=>$ ("wishlistName")?.focus(),40)}
$("wishlistAddTrigger")?.addEventListener("click",()=>{const panel=$("wishlistFormPanel");if(panel?.classList.contains("is-open"))closeWishlistCreatePanel();else openWishlistCreatePanel()});
document.addEventListener("click",e=>{const panel=$("wishlistFormPanel"),trigger=$("wishlistAddTrigger");if(panel?.classList.contains("is-open")&&!panel.contains(e.target)&&!trigger?.contains(e.target))closeWishlistCreatePanel()});
document.addEventListener("keydown",e=>{if(e.key==="Escape"){closeWishlistCreatePanel();closeWishlistLightbox()}});

// Wishlist creation: prevent native form navigation and persist through the API.
$("wishlistForm")?.addEventListener("submit", async e => {
  e.preventDefault();
  const form = e.currentTarget;
  const submit = form.querySelector('button[type="submit"]');
  const payload = {
    name: $("wishlistName").value.trim(),
    price: $("wishlistPrice").value === "" ? 0 : Number($("wishlistPrice").value),
    priority: $("wishlistPriority").value,
    targetDate: $("wishlistDate").value,
    note: $("wishlistNote").value.trim(),
    image: wishlistImageData
  };
  if (submit) { submit.disabled = true; submit.textContent = "Menyimpan..."; }
  try {
    const data = await api("/api/wishlist", { method: "POST", body: JSON.stringify(payload) });
    wishlist.unshift({ ...data.item, savedAmount: 0, remainingAmount: Number(data.item.price) || 0, contributions: [] });
    form.reset();
    wishlistImageData = "";
    $("wishlistImagePreview").classList.add("hidden");
    $("wishlistImagePreviewImg").removeAttribute("src");
    $("wishlistPriority").value = "medium";
    renderWishlist();
    closeWishlistCreatePanel();
    toast(data.message || "Wishlist berhasil ditambahkan.");
  } catch (err) {
    toast(err.message || "Wishlist gagal ditambahkan.", true);
  } finally {
    if (submit) { submit.disabled = false; submit.textContent = "＋ Tambah wishlist"; }
  }
});

// Wishlist product photo: compress locally, store with the wishlist item, and open a lightbox.
function openWishlistLightbox(src){$("wishlistLightboxImage").src=src;$("wishlistLightbox").classList.remove("hidden");document.body.classList.add("overlay-open")}
function closeWishlistLightbox(){$("wishlistLightbox")?.classList.add("hidden");$("wishlistLightboxImage")?.removeAttribute("src");document.body.classList.remove("overlay-open")}
$("wishlistImage")?.addEventListener("change",async e=>{const file=e.target.files?.[0];if(!file)return;if(!["image/jpeg","image/png","image/webp"].includes(file.type)){toast("Pilih gambar JPG, PNG, atau WebP.",true);e.target.value="";return}if(file.size>8*1024*1024){toast("Ukuran foto asli maksimal 8 MB.",true);e.target.value="";return}try{const bitmap=await createImageBitmap(file),max=900,scale=Math.min(1,max/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement("canvas");canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));const ctx=canvas.getContext("2d");ctx.fillStyle="#ffffff";ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close?.();wishlistImageData=canvas.toDataURL("image/jpeg",.78);if(wishlistImageData.length>1200000)wishlistImageData=canvas.toDataURL("image/jpeg",.62);if(wishlistImageData.length>1200000)throw new Error("Foto masih terlalu besar. Pilih gambar lain.");$("wishlistImagePreviewImg").src=wishlistImageData;$("wishlistImagePreview").classList.remove("hidden")}catch(err){wishlistImageData="";e.target.value="";toast(err.message||"Foto tidak dapat diproses.",true)}});
$("wishlistImageRemove")?.addEventListener("click",()=>{wishlistImageData="";$("wishlistImage").value="";$("wishlistImagePreview").classList.add("hidden");$("wishlistImagePreviewImg").removeAttribute("src")});
$("wishlistLightboxClose")?.addEventListener("click",closeWishlistLightbox);
$("wishlistLightbox")?.addEventListener("click",e=>{if(e.target.id==="wishlistLightbox")closeWishlistLightbox()});

// Calendar and analytics.

// Wishlist: persisted per account through the JSON database API.
async function loadWishlist(){if(!wishlistLoaded){$("wishlistList").setAttribute("aria-busy","true");$("wishlistList").innerHTML=Array.from({length:4},()=>'<article class="panel wishlist-card skeleton-card"><span class="skeleton skeleton-pill"></span><span class="skeleton skeleton-line wide"></span><span class="skeleton skeleton-price"></span><span class="skeleton skeleton-line"></span><span class="skeleton skeleton-button"></span></article>').join("");$("wishlistStats").innerHTML='<span class="skeleton skeleton-line short"></span>'}try{const data=await api("/api/wishlist");wishlist=data.items||[];wishlistLoaded=true;renderWishlist();$("wishlistList").setAttribute("aria-busy","false")}catch(e){if(!wishlistLoaded){wishlistLoaded=true;$("wishlistList").innerHTML='<div class="panel empty-feature">Wishlist belum dapat dimuat. Periksa koneksi lalu coba lagi.</div>';$("wishlistList").setAttribute("aria-busy","false")}if(currentUser)toast(e.message,true)}}
function renderWishlist(){
 const filter=$("wishlistFilter")?.value||"active",rows=wishlist.filter(x=>filter==="all"||(filter==="bought"?x.status==="bought":x.status!=="bought"));
 const active=wishlist.filter(x=>x.status!=="bought").length,bought=wishlist.filter(x=>x.status==="bought").length;
 const totalTarget=wishlist.filter(x=>x.status!=="bought").reduce((s,x)=>s+(Number(x.price)||0),0),totalSaved=wishlist.filter(x=>x.status!=="bought").reduce((s,x)=>s+(Number(x.savedAmount)||0),0);
 $("wishlistStats").textContent=`${active} belum dibeli · ${bought} sudah dibeli · Dana terkumpul ${money(totalSaved)} dari ${money(totalTarget)}`;
 $("wishlistList").innerHTML=rows.map(item=>{const target=Number(item.price)||0,saved=Number(item.savedAmount)||0,remaining=Math.max(0,target-saved),pct=target?Math.min(100,Math.round(saved/target*100)):0,contribs=Array.isArray(item.contributions)?item.contributions:[];return `<article class="panel wishlist-card ${item.status==="bought"?"is-bought":""}"><div class="wishlist-identity-row">${item.image?`<button type="button" class="wishlist-product-thumb" data-wishlist-image="${item.id}" aria-label="Perbesar foto ${escapeHtml(item.name)}"><img src="${item.image}" alt="Foto ${escapeHtml(item.name)}" loading="lazy"></button>`:""}<div class="wishlist-card-head"><div class="wishlist-card-title"><span class="wishlist-priority ${item.priority}">${({high:"Prioritas tinggi",medium:"Prioritas sedang",low:"Prioritas rendah"})[item.priority]||"Prioritas sedang"}</span><h3>${escapeHtml(item.name)}</h3></div><button class="icon-action delete" type="button" data-wishlist-delete="${item.id}" aria-label="Hapus wishlist">×</button></div></div><div class="wishlist-money-row"><div><small>ESTIMASI HARGA</small><div class="wishlist-price">${target?money(target):"Belum ditentukan"}</div></div><div class="wishlist-saved"><small>DANA TERKUMPUL</small><b>${money(saved)}</b></div></div><div class="wishlist-progress-track"><span style="width:${pct}%"></span></div><div class="wishlist-progress-meta"><b>${pct}% terkumpul</b><span>${target?(remaining?`Sisa ${money(remaining)}`:"Target tercapai"):`${contribs.length} kali menabung`}</span></div>${item.note?`<p class="wishlist-note">${escapeHtml(item.note)}</p>`:""}<div class="wishlist-card-foot"><span>${item.targetDate?"Target "+formatDate(item.targetDate):"Tanpa target tanggal"}</span><div class="wishlist-card-actions">${item.status!=="bought"?`<button type="button" class="btn secondary" data-wishlist-fund="${item.id}">＋ Tambah dana</button>`:""}<button type="button" class="btn ${item.status==="bought"?"secondary":"primary"}" data-wishlist-toggle="${item.id}">${item.status==="bought"?"Tandai belum dibeli":"Tandai sudah dibeli"}</button></div></div>${contribs.length?`<details class="wishlist-history"><summary>Riwayat dana (${contribs.length})</summary><div>${[...contribs].reverse().map(c=>`<div class="wishlist-history-row"><span>${formatDate(c.date)}${c.note?` · ${escapeHtml(c.note)}`:""}</span><b>+${money(c.amount)}</b></div>`).join("")}</div></details>`:""}</article>`}).join("")||'<div class="panel empty-feature">Belum ada item pada daftar ini. Tambahkan keinginan pertamamu.</div>';
}
function closeWishlistFundModal(){$("wishlistFundModal")?.classList.add("hidden");$("wishlistFundForm")?.reset();activeWishlistFundId=null}
function openWishlistFundModal(item){if(!item)return;activeWishlistFundId=item.id;$("wishlistFundId").value=item.id;$("wishlistFundItemName").textContent=item.name;$("wishlistFundDate").value=today();$("wishlistFundAmount").value="";$("wishlistFundNote").value="";$("wishlistFundModal").classList.remove("hidden");setTimeout(()=>$("wishlistFundAmount").focus(),30)}


$("wishlistList")?.addEventListener("click",async e=>{const imageBtn=e.target.closest("[data-wishlist-image]"),fund=e.target.closest("[data-wishlist-fund]"),toggle=e.target.closest("[data-wishlist-toggle]"),del=e.target.closest("[data-wishlist-delete]");try{if(imageBtn){const item=wishlist.find(x=>x.id===imageBtn.dataset.wishlistImage);if(item?.image)openWishlistLightbox(item.image);return}if(fund){openWishlistFundModal(wishlist.find(x=>x.id===fund.dataset.wishlistFund));return}if(toggle){const item=wishlist.find(x=>x.id===toggle.dataset.wishlistToggle);if(!item)return;const data=await api("/api/wishlist/"+item.id,{method:"PATCH",body:JSON.stringify({status:item.status==="bought"?"active":"bought"})});await loadWishlist();toast(data.message)}else if(del&&confirm("Hapus item wishlist ini?")){await api("/api/wishlist/"+del.dataset.wishlistDelete,{method:"DELETE"});await loadWishlist();toast("Item wishlist dihapus.")}}catch(err){toast(err.message,true)}});
$("wishlistFundForm")?.addEventListener("submit",async e=>{e.preventDefault();const id=activeWishlistFundId;if(!id)return;const submit=e.submitter;if(submit)submit.disabled=true;try{const data=await api(`/api/wishlist/${id}/contributions`,{method:"POST",body:JSON.stringify({amount:Number($("wishlistFundAmount").value),date:$("wishlistFundDate").value,note:$("wishlistFundNote").value})});closeWishlistFundModal();await loadWishlist();toast(data.message)}catch(err){toast(err.message,true)}finally{if(submit)submit.disabled=false}});
["closeWishlistFund","cancelWishlistFund"].forEach(id=>$(id)?.addEventListener("click",closeWishlistFundModal));
$("wishlistFundModal")?.addEventListener("click",e=>{if(e.target.id==="wishlistFundModal")closeWishlistFundModal()});

function renderCalendar(){const input=$("calendarMonth");if(!input)return;const month=input.value||monthNow();input.value=month;const [y,m]=month.split("-").map(Number),first=new Date(y,m-1,1),days=new Date(y,m,0).getDate(),offset=(first.getDay()+6)%7,labels=["Sen","Sel","Rab","Kam","Jum","Sab","Min"];let html=labels.map(x=>`<div class="calendar-label">${x}</div>`).join("");for(let i=0;i<offset;i++)html+='<div class="calendar-cell muted-cell"></div>';for(let day=1;day<=days;day++){const key=`${month}-${String(day).padStart(2,"0")}`,tx=transactions.filter(t=>t.date===key);html+=`<button type="button" class="calendar-cell ${tx.length?"has-events":""}" data-calendar-date="${key}"><b>${day}</b><small>${tx.length?tx.length+" transaksi":""}</small></button>`;}$("calendarGrid").innerHTML=html;$("calendarDetails").innerHTML=`<p class="muted">Pilih tanggal untuk melihat aktivitas. Bulan ini: ${transactions.filter(t=>t.date.startsWith(month)).length} transaksi .</p>`;}
$("calendarMonth")?.addEventListener("change",renderCalendar);
$("calendarGrid")?.addEventListener("click",e=>{const b=e.target.closest("[data-calendar-date]");if(!b)return;const date=b.dataset.calendarDate,tx=transactions.filter(t=>t.date===date);$("calendarDetails").innerHTML=`<h3>${formatDate(date)}</h3>${tx.map(t=>`<div class="report-row"><span>${escapeHtml(t.title)} · ${t.type==="income"?"Pemasukan":"Pengeluaran"}</span><b>${money(t.amount)}</b></div>`).join("")||'<p class="muted">Tidak ada transaksi pada tanggal ini.</p>'}`;});
function renderInsights(){const input=$("insightMonth");if(!input)return;const month=input.value||monthNow();input.value=month;const rows=transactions.filter(t=>t.date.startsWith(month)),inc=sum("income",rows),exp=sum("expense",rows),net=inc-exp,rate=inc?Math.round(net/inc*100):0,groups={};rows.filter(t=>t.type==="expense").forEach(t=>groups[t.category]=(groups[t.category]||0)+t.amount);const sorted=Object.entries(groups).sort((a,b)=>b[1]-a[1]);$("insightCards").innerHTML=[["Pemasukan",money(inc)],["Pengeluaran",money(exp)],["Arus bersih",money(net)],["Rasio bersih",rate+"%"]].map(([a,b])=>`<article class="summary-card"><div class="summary-top">${a}</div><div class="summary-value">${b}</div></article>`).join("");const max=sorted[0]?.[1]||1;$("insightCategories").innerHTML=sorted.map(([name,val])=>`<div class="category-item"><div class="category-line"><b>${escapeHtml(name)}</b><span>${money(val)}</span></div><div class="progress"><span style="width:${val/max*100}%"></span></div></div>`).join("")||'<p class="muted">Belum ada pengeluaran pada bulan ini.</p>';$("insightAdvice").textContent=!inc&&!exp?"Belum cukup data untuk membuat evaluasi.":net<0?"Pengeluaran lebih besar daripada pemasukan. Tinjau kategori terbesar dan sesuaikan pengeluaran.":rate<20?"Arus kas masih positif. Pertahankan selisih positif dan sisihkan dana sesuai kebutuhan.":"Arus kas positif pada bulan ini. Pertahankan pencatatan dan evaluasi arus kas secara berkala.";}
$("insightMonth")?.addEventListener("change",renderInsights);

function downloadCsv(){
 const rows=[["Tanggal","Jenis","Nama transaksi","Kategori","Nominal","Catatan"],...transactions.map(t=>[t.date,t.type==="income"?"Pemasukan":"Pengeluaran",t.title,t.category,t.amount,t.note||""])];
 const csv=rows.map(row=>row.map(v=>'"'+String(v??"").replace(/"/g,'""')+'"').join(",")).join("\r\n");
 const blob=new Blob(["\ufeff"+csv],{type:"text/csv;charset=utf-8"}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download="ditzz-finance-transaksi-"+today()+".csv";a.click();URL.revokeObjectURL(url);toast("Export CSV berhasil.");
}
async function downloadBackup(){try{const res=await fetch("/api/backup");if(!res.ok)throw new Error("Gagal mengunduh backup.");const blob=await res.blob(),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download="ditzz-finance-backup.json";a.click();URL.revokeObjectURL(url);toast("Backup berhasil diunduh.")}catch(e){toast(e.message,true)}}
$("restoreFile")?.addEventListener("change",async e=>{const file=e.target.files?.[0];if(!file)return;try{if(file.size>4*1024*1024)throw new Error("Ukuran backup maksimal 4 MB.");const data=JSON.parse(await file.text());if(!confirm("Pulihkan data dari backup? Data baru akan ditambahkan dan tidak menghapus data saat ini."))return;const result=await api("/api/restore",{method:"POST",body:JSON.stringify(data)});await loadTransactions();await loadWishlist();toast(result.message)}catch(err){toast(err.message,true)}finally{e.target.value=""}});
$("exportBtn").addEventListener("click",downloadBackup);$("csvBtn").addEventListener("click",downloadCsv);$("backupBtn").addEventListener("click",downloadBackup);
$("importBtn").addEventListener("click",()=>$("importFile").click());
function parseCsv(text){
 const rows=[];let row=[],cell="",quoted=false;
 for(let i=0;i<text.length;i++){const ch=text[i];if(ch==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(ch===","&&!quoted){row.push(cell);cell="";}else if((ch==="\n"||ch==="\r")&&!quoted){if(ch==="\r"&&text[i+1]==="\n")i++;row.push(cell);if(row.some(v=>v.trim()))rows.push(row);row=[];cell="";}else cell+=ch;}
 row.push(cell);if(row.some(v=>v.trim()))rows.push(row);if(rows.length<2)throw new Error("CSV tidak memiliki baris transaksi.");
 const headers=rows.shift().map(v=>v.trim().toLowerCase());
 const find=(...names)=>names.map(n=>headers.indexOf(n)).find(i=>i>=0);
 const ix={date:find("tanggal","date"),type:find("jenis","type"),title:find("nama transaksi","transaksi","title","nama"),category:find("kategori","category"),amount:find("nominal","jumlah","amount"),note:find("catatan","note")};
 if([ix.date,ix.type,ix.title,ix.category,ix.amount].some(i=>i===undefined))throw new Error("Header CSV tidak sesuai. Unduh contoh melalui format export CSV.");
 return rows.map((r)=>({date:(r[ix.date]||"").trim(),type:(r[ix.type]||"").trim().toLowerCase(),title:(r[ix.title]||"").trim(),category:(r[ix.category]||"").trim(),amount:Number(String(r[ix.amount]||"").replace(/[.\s]/g,"").replace(",",".")),note:ix.note===undefined?"":(r[ix.note]||"").trim()}));
}
$("importFile").addEventListener("change",async e=>{const file=e.target.files?.[0];if(!file)return;try{if(file.size>1024*1024)throw new Error("Ukuran CSV maksimal 1 MB.");const rows=parseCsv(await file.text());if(rows.length>500)throw new Error("Maksimal 500 transaksi per impor.");if(!confirm(`Impor ${rows.length} transaksi ke akun ini?`))return;const d=await api("/api/transactions/import",{method:"POST",body:JSON.stringify({rows})});await loadTransactions();toast(d.message);}catch(err){toast(err.message,true)}finally{e.target.value="";}});
$("passwordForm").addEventListener("submit",async e=>{e.preventDefault();if($("newPassword").value!==$("confirmPassword").value)return toast("Konfirmasi password tidak sama.",true);try{const d=await api("/api/change-password",{method:"POST",body:JSON.stringify({currentPassword:$("currentPassword").value,newPassword:$("newPassword").value})});toast(d.message);$("passwordForm").reset()}catch(err){toast(err.message,true)}});
$("menuBtn").addEventListener("click",()=>{$("sidebar").classList.toggle("open");$("sidebarScrim")?.classList.toggle("show",$("sidebar").classList.contains("open"))});
refreshSession();
if("serviceWorker" in navigator){window.addEventListener("load",()=>navigator.serviceWorker.register("/sw.js").catch(()=>{}));}

// Floating calculator: independent from transaction records.
(function setupFloatingCalculator(){
 const panel=document.getElementById("calculatorPanel"),fab=document.getElementById("calculatorFab"),close=document.getElementById("calculatorClose"),display=document.getElementById("calculatorDisplay"),history=document.getElementById("calculatorHistory"),keys=document.querySelector(".calculator-keys");
 if(!panel||!fab||!close||!display||!history||!keys)return;
 let current="0",stored=null,operator=null,waiting=false,finished=false;
 const render=()=>{display.textContent=current;};
 const format=n=>{if(!Number.isFinite(n))throw new Error("Perhitungan tidak valid");return String(Number(n.toPrecision(12)));};
 const calculate=(a,b,op)=>{switch(op){case "+":return a+b;case "−":return a-b;case "×":return a*b;case "÷":if(b===0)throw new Error("Tidak bisa membagi dengan nol");return a/b;default:return b;}};
 function reset(){current="0";stored=null;operator=null;waiting=false;finished=false;history.textContent="Siap menghitung";render();}
 function pressDigit(d){if(waiting||finished){current=d;waiting=false;finished=false;}else current=current==="0"?d:current.length<15?current+d:current;render();}
 function chooseOperator(op){const value=Number(current);if(operator&& !waiting){try{current=format(calculate(stored,value,operator));}catch(e){history.textContent=e.message;reset();return;}}stored=Number(current);operator=op;waiting=true;finished=false;history.textContent=`${current} ${op}`;render();}
 function equals(){if(!operator||stored===null)return;const left=stored,right=Number(current),op=operator;try{const result=format(calculate(left,right,op));history.textContent=`${left} ${op} ${right} =`;current=result;stored=null;operator=null;waiting=false;finished=true;render();}catch(e){history.textContent=e.message;current="Error";stored=null;operator=null;waiting=true;render();}}
 function action(type,value){if(type==="digit")return pressDigit(value);if(type==="clear")return reset();if(type==="backspace"){if(waiting)return;if(finished)finished=false;current=current.length>1?current.slice(0,-1):"0";if(current==="-")current="0";return render();}if(type==="decimal"){if(waiting||finished){current="0.";waiting=false;finished=false;}else if(!current.includes("."))current+=".";return render();}if(type==="sign"){if(current!=="0"&&current!=="Error")current=current.startsWith("-")?current.slice(1):"-"+current;return render();}if(type==="percent"){if(current!=="Error")current=format(Number(current)/100);return render();}if(type==="operator")return chooseOperator(value);if(type==="equals")return equals();}
 fab.addEventListener("click",()=>{panel.classList.toggle("hidden");fab.setAttribute("aria-label",panel.classList.contains("hidden")?"Buka kalkulator":"Tutup kalkulator");});
 close.addEventListener("click",()=>{panel.classList.add("hidden");fab.setAttribute("aria-label","Buka kalkulator");});
 keys.addEventListener("click",e=>{const b=e.target.closest("button[data-calc]");if(b)action(b.dataset.calc,b.dataset.value);});
 document.addEventListener("keydown",e=>{if(panel.classList.contains("hidden")||e.ctrlKey||e.metaKey||e.altKey)return;if(/^[0-9]$/.test(e.key))action("digit",e.key);else if(e.key===".")action("decimal");else if(e.key==="+")action("operator","+");else if(e.key==="-")action("operator","−");else if(e.key==="*")action("operator","×");else if(e.key==="/"){e.preventDefault();action("operator","÷");}else if(e.key==="Enter"||e.key==="=")action("equals");else if(e.key==="Escape")close.click();else if(e.key==="Backspace"){e.preventDefault();action("backspace");}});
})();

// Push notifications: subscribe this device and manage reminder preferences.
function urlBase64ToUint8Array(value){
 const padding="=".repeat((4-value.length%4)%4),base64=(value+padding).replace(/-/g,"+").replace(/_/g,"/");
 const raw=atob(base64),output=new Uint8Array(raw.length);
 for(let i=0;i<raw.length;i++)output[i]=raw.charCodeAt(i);
 return output;
}
function setPushStatus(message,error=false){const el=$("pushStatus");if(!el)return;el.textContent=message;el.classList.toggle("error",error);}
async function loadPushSettings(){
 if(!$("pushPrefsForm"))return;
 try{
  const data=await api("/api/push/settings"),p=data.preferences||{};
  $("prefBackup").checked=p.backupReminder===true;
  $("prefTime").value=p.reminderTime||"09:00";$("prefBackupDay").value=String(p.backupWeekday??0);
  const supported="serviceWorker" in navigator&&"PushManager" in window&&"Notification" in window;
  if(!supported){setPushStatus("Browser ini belum mendukung Push Notification. Coba Chrome Android atau Safari iPhone yang mendukung PWA.",true);$("pushEnable").disabled=true;return;}
  const reg=await navigator.serviceWorker.ready,sub=await reg.pushManager.getSubscription();
  if(sub){setPushStatus("Aktif di perangkat ini. Perangkat terdaftar: "+data.devices+".");$("pushEnable").disabled=true;$("pushTest").disabled=false;$("pushDisable").disabled=false;}
  else{setPushStatus(Notification.permission==="denied"?"Izin notifikasi diblokir browser. Ubah izin situs di pengaturan browser.":"Belum aktif di perangkat ini. Aktifkan untuk menerima notifikasi.");$("pushEnable").disabled=false;$("pushTest").disabled=true;$("pushDisable").disabled=true;}
 }catch(e){setPushStatus(e.message,true);}
}
$("pushEnable")?.addEventListener("click",async()=>{
 try{
  if(!window.isSecureContext)throw new Error("Push Notification memerlukan HTTPS. Untuk pengujian lokal, gunakan localhost.");
  if(!("serviceWorker" in navigator)||!("PushManager" in window)||!("Notification" in window))throw new Error("Browser ini belum mendukung Push Notification.");
  const permission=await Notification.requestPermission();
  if(permission!=="granted")throw new Error(permission==="denied"?"Izin notifikasi ditolak. Aktifkan izin situs melalui pengaturan browser.":"Izin notifikasi belum diberikan.");
  const registration=await navigator.serviceWorker.register("/sw.js"),ready=await navigator.serviceWorker.ready;
  const settings=await api("/api/push/settings");
  let subscription=await ready.pushManager.getSubscription();
  if(!subscription)subscription=await ready.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlBase64ToUint8Array(settings.publicKey)});
  const saved=await api("/api/push/subscribe",{method:"POST",body:JSON.stringify({subscription:subscription.toJSON()})});
  setPushStatus(saved.message);toast(saved.message);await loadPushSettings();
 }catch(e){setPushStatus(e.message,true);toast(e.message,true);}
});
$("pushTest")?.addEventListener("click",async()=>{try{const d=await api("/api/push/test",{method:"POST",body:JSON.stringify({})});toast(d.message);}catch(e){toast(e.message,true);}});
$("pushDisable")?.addEventListener("click",async()=>{
 try{const reg=await navigator.serviceWorker.ready,sub=await reg.pushManager.getSubscription();if(sub){await api("/api/push/subscribe",{method:"DELETE",body:JSON.stringify({endpoint:sub.endpoint})});await sub.unsubscribe();}await loadPushSettings();toast("Notifikasi dinonaktifkan pada perangkat ini.");}catch(e){toast(e.message,true);}
});
$("pushPrefsForm")?.addEventListener("submit",async e=>{
 e.preventDefault();
 try{const payload={backupReminder:$("prefBackup").checked,reminderTime:$("prefTime").value,backupWeekday:Number($("prefBackupDay").value)};const d=await api("/api/push/preferences",{method:"PUT",body:JSON.stringify(payload)});toast(d.message);}catch(err){toast(err.message,true);}
});

// Motion-ready startup: reveal the app shell without delaying data loading.
document.documentElement.classList.add("motion-ready");
