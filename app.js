/* =====================================================================
   PDV PIZZARIA ERI LANCHES — app.js
   ===================================================================== */
const SUPABASE_URL      = 'https://rhyhgjjkjeggfvnillnc.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_Ud6dDCvayV663s9eztomqQ_vGnub2OK';

// Cria a instância do cliente
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
/* ----------------------------- HELPERS ----------------------------- */
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const money = n => 'R$ ' + Number(n || 0).toFixed(2).replace('.', ',');
const num   = v => Number(String(v ?? '').replace(/[^\d,.-]/g, '').replace(',', '.')) || 0;
const uid   = () => Math.random().toString(36).slice(2, 10);
const esc   = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
const hoje  = () => new Date().toISOString().slice(0, 10);
const hora  = d => new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const dataHora = d => new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const minsFrom = d => Math.floor((Date.now() - new Date(d).getTime()) / 60000);

function toast(msg, type = 'ok') {
  const el = document.createElement('div');
  el.className = 'toast ' + (type === 'ok' ? '' : type);
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 3600);
}
function erro(e) { console.error(e); toast(e?.message || 'Erro inesperado', 'err'); }

function getNomeCliente() {
  if (state.pdv.modo === 'mesa') return $('#m-nome').value.trim();
  if (state.pdv.modo === 'retirada') return $('#r-nome').value.trim();
  return $('#c-nome').value.trim();
}
function getTelCliente() {
  if (state.pdv.modo === 'retirada') return $('#r-tel').value.trim();
  return $('#c-tel').value.trim();
}

function modal({ title, body, footer, wide }) {
  $('#modal').className = 'modal' + (wide ? ' wide' : '');
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = body;
  $('#modal-footer').innerHTML = footer ?? '<button class="btn ghost" data-close>Fechar</button>';
  $('#backdrop').classList.add('show');
  $$('[data-close]').forEach(b => b.onclick = closeModal);
  return $('#modal-body');
}
const closeModal = () => $('#backdrop').classList.remove('show');
$('#backdrop').onclick = e => { if (e.target.id === 'backdrop') closeModal(); };
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
let touchStartY = 0;
$('#modal').addEventListener('touchstart', e => { touchStartY = e.touches[0].clientY; }, { passive: true });
$('#modal').addEventListener('touchend', e => {
  const delta = e.changedTouches[0].clientY - touchStartY;
  if (delta > 80 && $('#modal').scrollTop <= 0) closeModal();
});

const LABEL_TIPO = { retirada:'Retirada', entrega:'Entrega', mesa:'Mesa' };
const LABEL_ST   = { aberto:'Aberto', recebido:'Recebido', producao:'Em produção', pronto:'Pronto',
                     entrega:'Em rota', finalizado:'Finalizado', cancelado:'Cancelado' };
const PAGAMENTOS = ['Dinheiro','Pix','Cartão Débito','Cartão Crédito','Vale/Fiado'];

/* ------------------------------ STATE ------------------------------ */
const state = {
  user: null, settings: {}, cats: [], prods: [], tables: [], customers: [], bairros: [],
  orders: [], caixa: null, view: 'pdv',
  pdv: { modo:'retirada', cart:[], mesaId:null, cliente:null, desconto:0, taxa:0, servico:false, cat:'todos', busca:'' }
};

/* ------------------------------- AUTH ------------------------------ */
$('#login-form').onsubmit = async e => {
  e.preventDefault();
  $('#login-err').textContent = '';
  const { error } = await sb.auth.signInWithPassword({
    email: $('#login-email').value.trim(), password: $('#login-pass').value
  });
  if (error) { $('#login-err').textContent = 'E-mail ou senha inválidos.'; return; }
  location.reload();
};
$('#btn-logout').onclick = async () => { await sb.auth.signOut(); location.reload(); };

(async function boot() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { $('#login').classList.remove('hidden'); return; }
  state.user = session.user;
  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#user-email').textContent = session.user.email;
  await loadAll();
  bindUI();
  subscribeRealtime();
  render();
  setInterval(() => {
    $('#clock').textContent = new Date().toLocaleTimeString('pt-BR');
    if (state.view === 'cozinha') renderKds();
  }, 1000);
})();

/* ------------------------------ LOAD ------------------------------- */
async function loadAll() {
  const [set, cats, prods, tabs, cli, bai, cx] = await Promise.all([
    sb.from('settings').select('*').eq('id', 1).maybeSingle(),
    sb.from('categories').select('*').order('ordem'),
    sb.from('products').select('*').order('ordem'),
    sb.from('restaurant_tables').select('*').order('numero'),
    sb.from('customers').select('*').order('nome'),
    sb.from('neighborhoods').select('*').order('nome'),
    sb.from('cash_sessions').select('*').eq('status','aberto').order('aberto_em',{ascending:false}).limit(1)
  ]);
  state.settings  = set.data || {};
  state.cats      = cats.data || [];
  state.prods     = prods.data || [];
  state.tables    = tabs.data || [];
  state.customers = cli.data || [];
  state.bairros   = bai.data || [];
  state.caixa     = (cx.data || [])[0] || null;
  $('#store-name').textContent = state.settings.nome_loja || 'Eri Lanches';
  document.title = 'PDV — ' + (state.settings.nome_loja || 'Eri Lanches');
  await loadOrders();
}

async function loadOrders() {
  const ini = new Date(); ini.setHours(0,0,0,0);
  const { data, error } = await sb.from('orders')
    .select('*, order_items(*)')
    .or(`created_at.gte.${ini.toISOString()},status.in.(aberto,recebido,producao,pronto,entrega)`)
    .order('numero', { ascending: false });
  if (error) return erro(error);
  state.orders = data || [];
}

function subscribeRealtime() {
  sb.channel('pdv-live')
    .on('postgres_changes', { event:'*', schema:'public', table:'orders' },      softRefresh)
    .on('postgres_changes', { event:'*', schema:'public', table:'order_items' }, softRefresh)
    .on('postgres_changes', { event:'*', schema:'public', table:'restaurant_tables' }, softRefresh)
    .subscribe();
}
let refTimer;
function softRefresh() {
  clearTimeout(refTimer);
  refTimer = setTimeout(async () => {
    await loadOrders();
    const { data } = await sb.from('restaurant_tables').select('*').order('numero');
    state.tables = data || state.tables;
    render();
  }, 400);
}

/* ------------------------------ ROUTER ----------------------------- */
function go(view) {
  state.view = view;
  $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  $$('.view').forEach(v => v.classList.toggle('active', v.dataset.view === view));
  render();
}
function render() {
  renderCaixaPill(); renderBadges();
  ({ pdv: renderPdv, mesas: renderMesas, pedidos: renderPedidos, cozinha: renderKds,
     clientes: renderClientes, produtos: renderProdutos, caixa: renderCaixa,
     relatorios: renderRelBase, config: renderConfig }[state.view] || (()=>{}))();
}
function renderCaixaPill() {
  const p = $('#caixa-pill');
  p.className = 'pill ' + (state.caixa ? 'on' : 'off');
  p.textContent = state.caixa ? '● Caixa aberto' : '● Caixa fechado';
}
function renderBadges() {
  const fila = state.orders.filter(o => ['recebido','producao','pronto','entrega'].includes(o.status)).length;
  const coz  = state.orders.filter(o => ['recebido','producao'].includes(o.status)).length;
  $('#badge-pedidos').textContent = fila; $('#badge-pedidos').classList.toggle('show', fila > 0);
  $('#badge-cozinha').textContent = coz;  $('#badge-cozinha').classList.toggle('show', coz > 0);
}

/* ------------------------------ BIND UI ---------------------------- */
function bindUI() {
  $$('.nav-btn').forEach(b => b.onclick = () => go(b.dataset.view));
  $$('#pdv-modes .mode').forEach(b => b.onclick = () => {
    state.pdv.modo = b.dataset.modo; state.pdv.mesaId = null;
    state.pdv.taxa = b.dataset.modo === 'entrega' ? Number(state.settings.taxa_entrega_padrao || 0) : 0;
    renderPdv();
  });
  $('#pdv-search').oninput = e => { state.pdv.busca = e.target.value.toLowerCase(); renderProdGrid(); };
  $('#pdv-obs').oninput    = () => {};
  $('#t-desc').oninput = e => { state.pdv.desconto = num(e.target.value); renderTotais(); };
  $('#t-taxa').oninput = e => { state.pdv.taxa = num(e.target.value); renderTotais(); };
  $('#t-serv').onchange = e => { state.pdv.servico = e.target.checked; renderTotais(); };
  $('#btn-limpar').onclick = () => { if (confirm('Limpar o pedido atual?')) resetPdv(); };
  $('#btn-finalizar').onclick = finalizar;
  $('#btn-buscar-cli').onclick = buscarClientePorTel;
  $('#c-tel').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); buscarClientePorTel(); } };
  $('#r-tel').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); buscarClientePorTel(); } };
  $('#c-bairro').onchange = e => {
    const b = state.bairros.find(x => x.nome === e.target.value);
    if (b) { state.pdv.taxa = Number(b.taxa); $('#t-taxa').value = b.taxa; renderTotais(); }
  };
  $('#btn-nova-mesa').onclick = novaMesa;
  $('#cli-search').oninput = renderClientes;
  $('#btn-novo-cli').onclick = () => formCliente();
  $('#prod-search').oninput = renderProdutos;
  $('#btn-novo-prod').onclick = () => formProduto();
  $('#rel-de').value = hoje(); $('#rel-ate').value = hoje();
  $('#btn-rel').onclick = gerarRelatorio;
}

/* =====================================================================
   PDV
   ===================================================================== */
const precoDe = p => Number(state.pdv.modo === 'mesa' ? p.preco_mesa : p.preco_entrega);

function renderPdv() {
  $$('#pdv-modes .mode').forEach(b => b.classList.toggle('active', b.dataset.modo === state.pdv.modo));

  $('#pdv-banner').classList.add('hidden');

  // categorias
  $('#pdv-cats').innerHTML =
    `<button class="chip ${state.pdv.cat==='todos'?'active':''}" data-c="todos">Todos</button>` +
    state.cats.map(c => `<button class="chip ${state.pdv.cat==c.id?'active':''}" data-c="${c.id}">${esc(c.nome)}</button>`).join('');
  $$('#pdv-cats .chip').forEach(b => b.onclick = () => {
    state.pdv.cat = b.dataset.c === 'todos' ? 'todos' : Number(b.dataset.c);
    renderPdv();
  });

  renderProdGrid();
  $('#mesa-box').classList.toggle('hidden', state.pdv.modo !== 'mesa');
  $('#retirada-box').classList.toggle('hidden', state.pdv.modo !== 'retirada');
  $('#entrega-box').classList.toggle('hidden', state.pdv.modo !== 'entrega');
  $('#lin-taxa').classList.toggle('hidden', state.pdv.modo !== 'entrega');
  $('#lin-serv').classList.toggle('hidden', state.pdv.modo !== 'mesa');
  $('#serv-pc').textContent = `(${Number(state.settings.taxa_servico_percent || 0)}%)`;
  $('#c-bairro').innerHTML = '<option value="">Selecione...</option>' +
    state.bairros.map(b => `<option ${state.pdv.cliente?.bairro===b.nome?'selected':''} value="${esc(b.nome)}">${esc(b.nome)} — ${money(b.taxa)}</option>`).join('');
  $('#t-taxa').value = state.pdv.taxa;
  $('#t-desc').value = state.pdv.desconto;
  $('#t-serv').checked = state.pdv.servico;
  renderCart();
}

function renderProdGrid() {
  const q = state.pdv.busca;
  const list = state.prods.filter(p =>
    (state.pdv.cat === 'todos' || p.categoria_id === state.pdv.cat) &&
    (!q || p.nome.toLowerCase().includes(q) || (p.descricao || '').toLowerCase().includes(q)));
  $('#pdv-products').innerHTML = list.length ? list.map(p => `
    <div class="prod-card ${p.ativo ? '' : 'off'}" data-id="${p.id}">
      ${p.is_pizza ? '<span class="tag">🍕 aceita meio a meio</span>' : ''}
      <b>${esc(p.nome)}</b><small>${esc(p.descricao)}</small>
      <span class="price">${money(precoDe(p))}</span>
      ${p.ativo ? '' : '<small style="color:#ff8a7a">Indisponível</small>'}
    </div>`).join('') : '<p class="muted">Nenhum produto encontrado.</p>';
  $$('#pdv-products .prod-card').forEach(c => c.onclick = () => {
    const p = state.prods.find(x => x.id === c.dataset.id);
    if (!p?.ativo) return toast('Produto indisponível', 'warn');
    p.is_pizza ? escolherPizza(p) : addItem({ p });
  });
}

/* --------- pizza inteira / meio a meio --------- */
function escolherPizza(p) {
  const pizzas = state.prods.filter(x => x.is_pizza && x.ativo && x.id !== p.id);
  modal({
    title: `${p.nome} — como deseja?`, wide: true,
    body: `
      <div class="row" style="gap:9px;margin-bottom:14px">
        <button class="btn primary grow" id="op-int">🍕 Pizza inteira — ${money(precoDe(p))}</button>
        <button class="btn grow" id="op-meio">½ Meio a meio</button>
      </div>
      <div id="half-box" class="hidden">
        <p class="muted" style="margin-bottom:9px">Escolha o 2º sabor (vale o maior valor):</p>
        <input id="half-q" placeholder="Buscar sabor..." style="margin-bottom:10px">
        <div class="pick-list" id="half-list">
          ${pizzas.map(x => `<button class="pick" data-id="${x.id}">
            <b>${esc(x.nome)}</b><small>${money(precoDe(x))}</small></button>`).join('')}
        </div>
      </div>`,
    footer: '<button class="btn ghost" data-close>Cancelar</button>'
  });
  $('#op-int').onclick = () => { addItem({ p }); closeModal(); };
  $('#op-meio').onclick = () => $('#half-box').classList.remove('hidden');
  $('#half-q').oninput = e => {
    const q = e.target.value.toLowerCase();
    $$('#half-list .pick').forEach(b => {
      const n = state.prods.find(x => x.id === b.dataset.id)?.nome.toLowerCase() || '';
      b.style.display = n.includes(q) ? '' : 'none';
    });
  };
  $$('#half-list .pick').forEach(b => b.onclick = () => {
    addItem({ p, p2: state.prods.find(x => x.id === b.dataset.id) });
    closeModal();
  });
}

function addItem({ p, p2 = null }) {
  const preco = p2 ? Math.max(precoDe(p), precoDe(p2)) : precoDe(p);
  const nome  = p2 ? `½ ${p.nome} / ½ ${p2.nome}` : p.nome;
  const igual = state.pdv.cart.find(i => i.nome === nome && !i.obs);
  if (igual) igual.qtd++;
  else state.pdv.cart.push({
    uid: uid(), product_id: p.id, produto2_id: p2?.id || null,
    nome, nome2: p2?.nome || '', meio: !!p2, qtd: 1, preco, obs: ''
  });
  renderCart(); toast(nome + ' adicionado');
  setTimeout(() => {
    const cart = $('#cart-items');
    if (cart && cart.scrollHeight > cart.clientHeight) cart.scrollTop = cart.scrollHeight;
  }, 50);
}

function renderCart() {
  const c = $('#cart-items');
  c.innerHTML = state.pdv.cart.length ? state.pdv.cart.map(i => `
    <div class="ci" data-uid="${i.uid}">
      <div class="ci-top">
        <div><b>${esc(i.nome)}</b>${i.obs ? `<small>📝 ${esc(i.obs)}</small>` : ''}</div>
        <span class="ci-price">${money(i.preco * i.qtd)}</span>
      </div>
      <div class="ci-bot">
        <div class="qty"><button data-a="menos">−</button><span>${i.qtd}</span><button data-a="mais">+</button></div>
        <button class="btn ghost sm" data-a="obs">📝</button>
        <button class="btn danger sm" data-a="del">Remover</button>
      </div>
    </div>`).join('') : '<div class="cart-empty">Nenhum item. Toque nos produtos ao lado.</div>';

  $$('#cart-items .ci').forEach(el => {
    const it = state.pdv.cart.find(i => i.uid === el.dataset.uid);
    $$('[data-a]', el).forEach(b => b.onclick = () => {
      const a = b.dataset.a;
      if (a === 'mais') it.qtd++;
      if (a === 'menos') { it.qtd--; if (it.qtd <= 0) state.pdv.cart = state.pdv.cart.filter(i => i !== it); }
      if (a === 'del') state.pdv.cart = state.pdv.cart.filter(i => i !== it);
      if (a === 'obs') { const v = prompt('Observação do item:', it.obs); if (v !== null) it.obs = v.trim(); }
      renderCart();
    });
  });
  renderTotais();
}

function calc() {
  const sub  = state.pdv.cart.reduce((s, i) => s + i.preco * i.qtd, 0);
  const desc = Math.min(state.pdv.desconto, sub);
  const taxa = state.pdv.modo === 'entrega' ? state.pdv.taxa : 0;
  const serv = state.pdv.modo === 'mesa' && state.pdv.servico
    ? (sub - desc) * Number(state.settings.taxa_servico_percent || 0) / 100 : 0;
  return { sub, desc, taxa, serv, total: sub - desc + taxa + serv };
}
function renderTotais() {
  const t = calc();
  $('#t-sub').textContent = money(t.sub);
  $('#t-total').textContent = money(t.total);
}
function resetPdv() {
  const modo = state.pdv.modo;
  state.pdv = { modo, cart:[], mesaId:null, cliente:null, desconto:0,
                taxa:0, servico:false, cat:state.pdv.cat, busca:'' };
  $('#pdv-obs').value = '';
  ['m-nome','r-tel','r-nome','c-tel','c-nome','c-end','c-num','c-ref'].forEach(id => $('#'+id).value = '');
  renderPdv();
}

/* --------- cliente por telefone --------- */
function buscarClientePorTel() {
  const tel = getTelCliente().replace(/\D/g, '');
  if (!tel) return;
  const c = state.customers.find(x => (x.telefone || '').replace(/\D/g, '') === tel);
  if (!c) return toast('Cliente novo — preencha os dados', 'warn');
  state.pdv.cliente = c;
  if (state.pdv.modo === 'mesa') { $('#m-nome').value = c.nome; }
  else if (state.pdv.modo === 'retirada') { $('#r-nome').value = c.nome; $('#r-tel').value = c.telefone || ''; }
  else { $('#c-nome').value = c.nome; $('#c-tel').value = c.telefone || ''; }
  toast('Cliente: ' + c.nome);
}

/* --------- finalizar --------- */
async function finalizar() {
  if (!state.pdv.cart.length) return toast('Adicione itens ao pedido', 'warn');
  if (!state.caixa) return toast('Abra o caixa antes de vender', 'err');
  const nome = getNomeCliente();
  if (state.pdv.modo === 'entrega') {
    if (!nome) return toast('Informe o nome do cliente', 'warn');
    if (!$('#c-end').value.trim())  return toast('Informe o endereço', 'warn');
  }
  if (state.pdv.modo === 'retirada') {
    if (!nome) return toast('Informe o nome do cliente', 'warn');
  }
  if (state.pdv.modo === 'mesa') {
    if (!nome) return toast('Informe o nome da mesa', 'warn');
  }
  modalPagamento();
}

function modalPagamento() {
  const t = calc();
  modal({
    title: 'Pagamento — ' + money(t.total),
    body: `
      <div class="pay-grid" id="pay-grid">
        ${PAGAMENTOS.map((p, i) => `<div class="pay ${i===0?'sel':''}" data-p="${p}">${p}</div>`).join('')}
      </div>
      <div class="form-grid">
        <label>Valor recebido<input id="pg-valor" inputmode="decimal" value="${t.total.toFixed(2)}"></label>
        <label>Troco<input id="pg-troco" readonly value="R$ 0,00"></label>
      </div>
      <label style="margin-top:12px"><input type="checkbox" id="pg-print" checked style="width:auto"> Imprimir cupom</label>`,
    footer: `<button class="btn ghost" data-close>Cancelar</button>
             <button class="btn green" id="pg-ok">✔ Confirmar venda</button>`
  });
  let metodo = PAGAMENTOS[0];
  const troco = () => {
    const v = num($('#pg-valor').value);
    $('#pg-troco').value = money(Math.max(0, v - t.total));
  };
  $$('#pay-grid .pay').forEach(b => b.onclick = () => {
    $$('#pay-grid .pay').forEach(x => x.classList.remove('sel'));
    b.classList.add('sel'); metodo = b.dataset.p;
  });
  $('#pg-valor').oninput = troco; troco();
  $('#pg-ok').onclick = async () => {
    $('#pg-ok').disabled = true;
    await salvarPedido(metodo, num($('#pg-valor').value), $('#pg-print').checked);
  };
}

async function salvarPedido(pagamento, valorPago, imprimir) {
  try {
    const t = calc();
    let customer_id = state.pdv.cliente?.id || null;
    const tel = getTelCliente(), nome = getNomeCliente();

    if (state.pdv.modo === 'entrega') {
      const payload = { nome, telefone: tel || null, endereco: $('#c-end').value.trim(),
        numero: $('#c-num').value.trim(), bairro: $('#c-bairro').value, referencia: $('#c-ref').value.trim() };
      if (customer_id) await sb.from('customers').update(payload).eq('id', customer_id);
      else {
        const { data, error } = await sb.from('customers').insert(payload).select().single();
        if (!error) { customer_id = data.id; state.customers.push(data); }
      }
    }

    if (state.pdv.modo === 'retirada' && nome) {
      const payload = { nome, telefone: tel || null };
      if (customer_id) await sb.from('customers').update(payload).eq('id', customer_id);
      else {
        const { data, error } = await sb.from('customers').insert(payload).select().single();
        if (!error) { customer_id = data.id; state.customers.push(data); }
      }
    }

    const endereco = state.pdv.modo === 'entrega'
      ? `${$('#c-end').value.trim()}, ${$('#c-num').value.trim()} — ${$('#c-bairro').value}${$('#c-ref').value ? ' ('+$('#c-ref').value+')' : ''}` : '';

    const { data: order, error } = await sb.from('orders').insert({
      tipo: state.pdv.modo, status: 'recebido', customer_id,
      cliente_nome: nome || 'Consumidor', cliente_telefone: tel, endereco,
      subtotal: t.sub, desconto: t.desc, taxa_entrega: t.taxa, taxa_servico: 0, total: t.total,
      pagamento, valor_pago: valorPago, troco: Math.max(0, valorPago - t.total),
      observacao: $('#pdv-obs').value.trim(), cash_session_id: state.caixa?.id || null
    }).select().single();
    if (error) throw error;

    await inserirItens(order.id, state.pdv.cart);
    closeModal();
    toast(`Pedido #${order.numero} registrado!`);
    const full = { ...order, order_items: state.pdv.cart.map(i => ({
      nome: i.nome, qtd: i.qtd, preco_unit: i.preco, total: i.preco * i.qtd, observacao: i.obs })) };
    resetPdv(); await loadOrders(); render();
    if (imprimir) imprimirCupom(full);
  } catch (e) { erro(e); }
}

const inserirItens = (order_id, cart) => sb.from('order_items').insert(cart.map(i => ({
  order_id, product_id: i.product_id, nome: i.nome, qtd: i.qtd, preco_unit: i.preco,
  total: i.preco * i.qtd, meio_a_meio: i.meio, produto2_id: i.produto2_id,
  nome2: i.nome2, observacao: i.obs
})));

/* =====================================================================
   MESAS
   ===================================================================== */
const contaDaMesa = mesaId => state.orders.find(o => o.mesa_id === mesaId && o.status === 'aberto');

function renderMesas() {
  $('#mesas-grid').innerHTML = state.tables.map(m => {
    const c = contaDaMesa(m.id);
    const tot = c ? Number(c.total) : 0;
    return `<div class="mesa-card ${c ? 'ocupada' : 'livre'}" data-id="${m.id}">
      <div class="n">${m.numero}</div>
      <div class="st">${c ? 'Ocupada' : 'Livre'}</div>
      ${c ? `<div class="vl">${money(tot)}</div><small class="muted">${hora(c.created_at)}</small>`
          : `<small class="muted">${m.lugares} lugares</small>`}
    </div>`;
  }).join('') || '<p class="muted">Nenhuma mesa cadastrada.</p>';
  $$('#mesas-grid .mesa-card').forEach(el => el.onclick = () => abrirMesa(Number(el.dataset.id)));
}

function abrirMesa(mesaId) {
  const m = state.tables.find(t => t.id === mesaId);
  const c = contaDaMesa(mesaId);
  const itens = (c?.order_items || []);
  modal({
    title: `Mesa ${m.numero}`, wide: true,
    body: c ? `
      <div class="box" style="margin:0 0 14px">
        <h4>Conta aberta desde ${hora(c.created_at)} — pedido #${c.numero}</h4>
        <table><thead><tr><th>Item</th><th>Qtd</th><th>Unit.</th><th>Total</th><th></th></tr></thead>
        <tbody>${itens.map(i => `<tr>
          <td>${esc(i.nome)}${i.observacao ? `<br><small class="muted">📝 ${esc(i.observacao)}</small>` : ''}</td>
          <td>${i.qtd}</td><td>${money(i.preco_unit)}</td><td>${money(i.total)}</td>
          <td><button class="btn danger sm" data-del="${i.id}">✕</button></td></tr>`).join('')}
        </tbody></table>
        <div class="lin total" style="margin-top:10px"><span>Subtotal</span><strong>${money(c.subtotal)}</strong></div>
      </div>` : '<p class="muted">Mesa livre. Lance os primeiros itens para abrir a conta.</p>',
    footer: `
      <button class="btn ghost" data-close>Fechar</button>
      ${c ? `<button class="btn blue" id="m-print">🖨️ Parcial</button>
             <button class="btn yellow" id="m-transf">↔ Transferir</button>
             <button class="btn green" id="m-fechar">💰 Fechar conta</button>` : ''}
      <button class="btn primary" id="m-add">+ Lançar itens</button>`
  });
  $('#m-add').onclick = () => {
    closeModal();
    state.pdv = { ...state.pdv, modo:'mesa', mesaId, cart:[], desconto:0, taxa:0, servico:false };
    go('pdv');
  };
  if (!c) return;
  $$('[data-del]').forEach(b => b.onclick = async () => {
    if (!confirm('Remover este item da conta?')) return;
    await sb.from('order_items').delete().eq('id', b.dataset.del);
    await recalcular(c.id); await loadOrders(); closeModal(); render();
  });
  $('#m-print').onclick  = () => imprimirCupom(c, true);
  $('#m-transf').onclick = () => transferirMesa(c);
  $('#m-fechar').onclick = () => fecharConta(c);
}

async function enviarParaMesa() {
  try {
    const nomeMesa = $('#m-nome').value.trim() || 'Mesa';
    const { data, error } = await sb.from('orders').insert({
      tipo: 'mesa', status: 'aberto', cliente_nome: nomeMesa,
      observacao: $('#pdv-obs').value.trim()
    }).select().single();
    if (error) throw error;
    await inserirItens(data.id, state.pdv.cart);
    await recalcular(data.id);
    toast('Pedido de mesa registrado!');
    const full = { ...data, order_items: state.pdv.cart.map(i => ({
      nome: i.nome, qtd: i.qtd, preco_unit: i.preco, total: i.preco * i.qtd, observacao: i.obs })) };
    resetPdv(); await loadOrders(); render();
    imprimirCupom(full);
  } catch (e) { erro(e); }
}

async function recalcular(orderId) {
  const { data: itens } = await sb.from('order_items').select('total').eq('order_id', orderId);
  const { data: o } = await sb.from('orders').select('desconto,taxa_entrega,taxa_servico').eq('id', orderId).single();
  const sub = (itens || []).reduce((s, i) => s + Number(i.total), 0);
  const total = sub - Number(o.desconto) + Number(o.taxa_entrega) + Number(o.taxa_servico);
  await sb.from('orders').update({ subtotal: sub, total, updated_at: new Date().toISOString() }).eq('id', orderId);
}

function fecharConta(c) {
  const pc = Number(state.settings.taxa_servico_percent || 0);
  modal({
    title: `Fechar conta — Mesa ${state.tables.find(t=>t.id===c.mesa_id)?.numero}`,
    body: `
      <div class="lin"><span>Subtotal</span><strong>${money(c.subtotal)}</strong></div>
      <div class="form-grid" style="margin:12px 0">
        <label>Desconto (R$)<input id="fc-desc" inputmode="decimal" value="0"></label>
        <label>Nº de pessoas (dividir)<input id="fc-pes" type="number" min="1" value="1"></label>
      </div>
      <label><input type="checkbox" id="fc-serv" style="width:auto" ${pc>0?'checked':''}> Incluir serviço ${pc}%</label>
      <div class="pay-grid" id="pay-grid" style="margin-top:14px">
        ${PAGAMENTOS.map((p,i)=>`<div class="pay ${i===0?'sel':''}" data-p="${p}">${p}</div>`).join('')}
      </div>
      <div class="form-grid">
        <label>Valor recebido<input id="fc-pago" inputmode="decimal"></label>
        <label>Troco<input id="fc-troco" readonly value="R$ 0,00"></label>
      </div>
      <div class="lin total" style="margin-top:12px"><span>TOTAL</span><strong id="fc-total">${money(c.total)}</strong></div>
      <div class="muted" id="fc-div"></div>`,
    footer: `<button class="btn ghost" data-close>Cancelar</button>
             <button class="btn green" id="fc-ok">✔ Receber e liberar mesa</button>`
  });
  let metodo = PAGAMENTOS[0];
  const calcFC = () => {
    const desc = num($('#fc-desc').value);
    const serv = $('#fc-serv').checked ? (Number(c.subtotal) - desc) * pc / 100 : 0;
    const total = Number(c.subtotal) - desc + serv;
    const pes = Math.max(1, Number($('#fc-pes').value) || 1);
    $('#fc-total').textContent = money(total);
    $('#fc-div').textContent = pes > 1 ? `${pes} pessoas × ${money(total/pes)}` : '';
    $('#fc-troco').value = money(Math.max(0, num($('#fc-pago').value) - total));
    return { desc, serv, total };
  };
  ['fc-desc','fc-pes','fc-pago'].forEach(id => $('#'+id).oninput = calcFC);
  $('#fc-serv').onchange = calcFC; calcFC();
  $$('#pay-grid .pay').forEach(b => b.onclick = () => {
    $$('#pay-grid .pay').forEach(x => x.classList.remove('sel')); b.classList.add('sel'); metodo = b.dataset.p;
  });
  $('#fc-ok').onclick = async () => {
    if (!state.caixa) return toast('Caixa fechado — abra o caixa', 'err');
    const f = calcFC(), pago = num($('#fc-pago').value) || f.total;
    const { error } = await sb.from('orders').update({
      status:'finalizado', desconto:f.desc, taxa_servico:f.serv, total:f.total,
      pagamento:metodo, valor_pago:pago, troco:Math.max(0,pago-f.total),
      finalizado_em:new Date().toISOString(), cash_session_id: state.caixa.id
    }).eq('id', c.id);
    if (error) return erro(error);
    await sb.from('restaurant_tables').update({ status:'livre' }).eq('id', c.mesa_id);
    closeModal(); toast('Mesa liberada!');
    await loadOrders(); render();
    imprimirCupom({ ...c, desconto:f.desc, taxa_servico:f.serv, total:f.total, pagamento:metodo });
  };
}

function transferirMesa(c) {
  const livres = state.tables.filter(t => !contaDaMesa(t.id));
  modal({
    title: 'Transferir conta',
    body: livres.length ? `<div class="pick-list">${livres.map(t =>
      `<button class="pick" data-id="${t.id}"><b>Mesa ${t.numero}</b><small>${t.lugares} lugares</small></button>`).join('')}</div>`
      : '<p class="muted">Nenhuma mesa livre.</p>'
  });
  $$('.pick').forEach(b => b.onclick = async () => {
    const dest = Number(b.dataset.id);
    await sb.from('orders').update({ mesa_id: dest }).eq('id', c.id);
    await sb.from('restaurant_tables').update({ status:'livre' }).eq('id', c.mesa_id);
    await sb.from('restaurant_tables').update({ status:'ocupada' }).eq('id', dest);
    closeModal(); toast('Conta transferida'); await loadOrders(); render();
  });
}

async function novaMesa() {
  const n = prompt('Número da nova mesa:');
  if (!n) return;
  const { error } = await sb.from('restaurant_tables').insert({ numero: Number(n), lugares: 4 });
  if (error) return erro(error);
  const { data } = await sb.from('restaurant_tables').select('*').order('numero');
  state.tables = data; renderMesas(); toast('Mesa criada');
}

/* =====================================================================
   PEDIDOS
   ===================================================================== */
let filtroPed = 'ativos';
function renderPedidos() {
  const fs = [['ativos','Em andamento'],['recebido','Recebidos'],['producao','Produção'],
              ['pronto','Prontos'],['entrega','Em rota'],['finalizado','Finalizados'],
              ['cancelado','Cancelados'],['todos','Todos']];
  $('#ped-filtros').innerHTML = fs.map(([k,l]) =>
    `<button class="chip ${filtroPed===k?'active':''}" data-f="${k}">${l}</button>`).join('');
  $$('#ped-filtros .chip').forEach(b => b.onclick = () => { filtroPed = b.dataset.f; renderPedidos(); });

  const list = state.orders.filter(o =>
    filtroPed === 'todos' ? true :
    filtroPed === 'ativos' ? ['recebido','producao','pronto','entrega'].includes(o.status) :
    o.status === filtroPed);

  $('#pedidos-list').innerHTML = list.length ? list.map(cardPedido).join('')
    : '<p class="muted">Nenhum pedido neste filtro.</p>';
  $$('#pedidos-list [data-act]').forEach(b => b.onclick = () => acaoPedido(b.dataset.act, b.dataset.id));
}

function cardPedido(o) {
  const prox = proximoStatus(o);
  const mesa = o.mesa_id ? state.tables.find(t => t.id === o.mesa_id)?.numero : null;
  return `<div class="order-card">
    <div class="oc-head">
      <span class="oc-num">#${o.numero}</span>
      <span class="st-pill st-${o.status}">${LABEL_ST[o.status]}</span>
    </div>
    <div class="muted">${LABEL_TIPO[o.tipo]}${mesa ? ' '+mesa : ''} • ${hora(o.created_at)}
      ${o.pagamento ? ' • '+o.pagamento : ''}</div>
    <div class="muted">${esc(o.cliente_nome || '')}${o.cliente_telefone ? ' • '+esc(o.cliente_telefone) : ''}</div>
    ${o.endereco ? `<div class="muted">📍 ${esc(o.endereco)}</div>` : ''}
    <div class="oc-items">${(o.order_items||[]).map(i =>
      `${i.qtd}× ${esc(i.nome)}${i.observacao ? ` <i>(${esc(i.observacao)})</i>` : ''}`).join('<br>')}
      ${o.observacao ? `<br><b>Obs:</b> ${esc(o.observacao)}` : ''}</div>
    <div class="oc-foot">
      <span class="oc-total">${money(o.total)}</span>
      <div class="oc-btns">
        ${prox ? `<button class="btn green sm" data-act="avancar" data-id="${o.id}">${prox.label}</button>` : ''}
        <button class="btn blue sm" data-act="print" data-id="${o.id}">🖨️</button>
        ${o.cliente_telefone ? `<button class="btn ghost sm" data-act="zap" data-id="${o.id}">💬</button>` : ''}
        ${['finalizado','cancelado'].includes(o.status) ? '' :
          `<button class="btn danger sm" data-act="cancel" data-id="${o.id}">✕</button>`}
      </div>
    </div></div>`;
}

function proximoStatus(o) {
  if (o.status === 'recebido') return { s:'producao',   label:'▶ Produzir' };
  if (o.status === 'producao') return { s:'pronto',     label:'✔ Pronto' };
  if (o.status === 'pronto')   return o.tipo === 'entrega'
    ? { s:'entrega', label:'🛵 Despachar' } : { s:'finalizado', label:'✔ Entregar' };
  if (o.status === 'entrega')  return { s:'finalizado', label:'✔ Concluir' };
  return null;
}

async function acaoPedido(act, id) {
  const o = state.orders.find(x => x.id === id);
  if (!o) return;
  if (act === 'print') return imprimirCupom(o);
  if (act === 'zap')   return whatsapp(o);
  if (act === 'cancel') {
    if (!confirm(`Cancelar o pedido #${o.numero}?`)) return;
    await sb.from('orders').update({ status:'cancelado' }).eq('id', id);
    if (o.mesa_id) await sb.from('restaurant_tables').update({ status:'livre' }).eq('id', o.mesa_id);
  }
  if (act === 'avancar') {
    const p = proximoStatus(o); if (!p) return;
    const upd = { status:p.s, updated_at:new Date().toISOString() };
    if (p.s === 'finalizado') { upd.finalizado_em = new Date().toISOString();
      if (!o.cash_session_id && state.caixa) upd.cash_session_id = state.caixa.id; }
    await sb.from('orders').update(upd).eq('id', id);
    toast(`#${o.numero} → ${LABEL_ST[p.s]}`);
  }
  await loadOrders(); render();
}

function whatsapp(o) {
  const tel = '55' + (o.cliente_telefone || '').replace(/\D/g, '');
  const itens = (o.order_items||[]).map(i => `• ${i.qtd}x ${i.nome} — ${money(i.total)}`).join('\n');
  const txt = `*${state.settings.nome_loja}*\nPedido *#${o.numero}* — ${LABEL_ST[o.status]}\n\n${itens}\n`
    + (Number(o.taxa_entrega) ? `\nEntrega: ${money(o.taxa_entrega)}` : '')
    + (Number(o.desconto) ? `\nDesconto: -${money(o.desconto)}` : '')
    + `\n*Total: ${money(o.total)}*\nPagamento: ${o.pagamento || '-'}\n`
    + `\nPrevisão: ~${state.settings.tempo_preparo || 40} min.\nObrigado! 🍕`;
  window.open(`[wa.me](https://wa.me/${tel}?text=${encodeURIComponent(txt)})`, '_blank');
}

/* =====================================================================
   COZINHA (KDS)
   ===================================================================== */
function renderKds() {
  const list = state.orders.filter(o => ['recebido','producao'].includes(o.status))
    .sort((a,b) => new Date(a.created_at) - new Date(b.created_at));
  $('#kds-grid').innerHTML = list.length ? list.map(o => {
    const m = minsFrom(o.created_at);
    const mesa = o.mesa_id ? ' — Mesa ' + state.tables.find(t=>t.id===o.mesa_id)?.numero : '';
    return `<div class="kds-card ${m > (state.settings.tempo_preparo||40) ? 'late' : ''}">
      <div class="oc-head"><span class="oc-num">#${o.numero}</span>
        <span class="st-pill st-${o.status}">${LABEL_ST[o.status]}</span></div>
      <div class="timer">⏱ ${m} min • ${LABEL_TIPO[o.tipo]}${mesa}</div>
      <ul>${(o.order_items||[]).map(i => `<li><b>${i.qtd}×</b> ${esc(i.nome)}
        ${i.observacao ? `<br><small class="muted">📝 ${esc(i.observacao)}</small>` : ''}</li>`).join('')}</ul>
      ${o.observacao ? `<div class="muted">Obs: ${esc(o.observacao)}</div>` : ''}
      <button class="btn ${o.status==='recebido'?'yellow':'green'} sm" data-act="avancar" data-id="${o.id}"
        style="width:100%;margin-top:8px">${o.status==='recebido'?'▶ Iniciar preparo':'✔ Marcar pronto'}</button>
    </div>`;
  }).join('') : '<p class="muted">Nenhum pedido na fila. 🎉</p>';
  $$('#kds-grid [data-act]').forEach(b => b.onclick = () => acaoPedido('avancar', b.dataset.id));
}

/* =====================================================================
   CLIENTES
   ===================================================================== */
function renderClientes() {
  const q = ($('#cli-search').value || '').toLowerCase();
  const list = state.customers.filter(c =>
    c.nome.toLowerCase().includes(q) || (c.telefone || '').includes(q));
  $('#clientes-table').innerHTML = `<table><thead><tr>
    <th>Nome</th><th>Telefone</th><th>Endereço</th><th>Bairro</th><th>Pedidos</th><th></th>
    </tr></thead><tbody>${list.map(c => {
      const n = state.orders.filter(o => o.customer_id === c.id).length;
      return `<tr><td><b>${esc(c.nome)}</b></td><td>${esc(c.telefone||'-')}</td>
        <td>${esc((c.endereco||'') + (c.numero ? ', '+c.numero : ''))}</td><td>${esc(c.bairro||'-')}</td>
        <td>${n}</td><td style="white-space:nowrap">
        <button class="btn ghost sm" data-ed="${c.id}">✏️</button>
        <button class="btn danger sm" data-del="${c.id}">🗑</button></td></tr>`;
    }).join('')}</tbody></table>`;
  $$('#clientes-table [data-ed]').forEach(b => b.onclick =
    () => formCliente(state.customers.find(c => c.id === b.dataset.ed)));
  $$('#clientes-table [data-del]').forEach(b => b.onclick = async () => {
    if (!confirm('Excluir cliente?')) return;
    const { error } = await sb.from('customers').delete().eq('id', b.dataset.del);
    if (error) return erro(error);
    state.customers = state.customers.filter(c => c.id !== b.dataset.del);
    renderClientes(); toast('Cliente excluído');
  });
}

function formCliente(c = null) {
  modal({
    title: c ? 'Editar cliente' : 'Novo cliente',
    body: `<div class="form-grid">
      <label>Nome*<input id="f-nome" value="${esc(c?.nome||'')}"></label>
      <label>Telefone<input id="f-tel" value="${esc(c?.telefone||'')}"></label>
      <label>Endereço<input id="f-end" value="${esc(c?.endereco||'')}"></label>
      <label>Número<input id="f-num" value="${esc(c?.numero||'')}"></label>
      <label>Bairro<select id="f-bai"><option value="">-</option>
        ${state.bairros.map(b => `<option ${c?.bairro===b.nome?'selected':''}>${esc(b.nome)}</option>`).join('')}
      </select></label>
      <label>Referência<input id="f-ref" value="${esc(c?.referencia||'')}"></label>
    </div>`,
    footer: `<button class="btn ghost" data-close>Cancelar</button>
             <button class="btn primary" id="f-ok">Salvar</button>`
  });
  $('#f-ok').onclick = async () => {
    const p = { nome:$('#f-nome').value.trim(), telefone:$('#f-tel').value.trim() || null,
      endereco:$('#f-end').value.trim(), numero:$('#f-num').value.trim(),
      bairro:$('#f-bai').value, referencia:$('#f-ref').value.trim() };
    if (!p.nome) return toast('Informe o nome', 'warn');
    const { error } = c ? await sb.from('customers').update(p).eq('id', c.id)
                        : await sb.from('customers').insert(p);
    if (error) return erro(error);
    const { data } = await sb.from('customers').select('*').order('nome');
    state.customers = data; closeModal(); renderClientes(); toast('Cliente salvo');
  };
}

/* =====================================================================
   PRODUTOS
   ===================================================================== */
function renderProdutos() {
  const q = ($('#prod-search').value || '').toLowerCase();
  const list = state.prods.filter(p => p.nome.toLowerCase().includes(q) || (p.descricao||'').toLowerCase().includes(q));
  $('#produtos-table').innerHTML = `<table><thead><tr>
    <th>Produto</th><th>Categoria</th><th>Entrega/Retirada</th><th>Mesa</th><th>Status</th><th></th>
    </tr></thead><tbody>${list.map(p => `<tr>
      <td><b>${esc(p.nome)}</b><br><small class="muted">${esc(p.descricao)}</small></td>
      <td>${esc(state.cats.find(c => c.id === p.categoria_id)?.nome || '-')}</td>
      <td>${money(p.preco_entrega)}</td><td>${money(p.preco_mesa)}</td>
      <td><span class="st-pill ${p.ativo?'st-pronto':'st-cancelado'}">${p.ativo?'Ativo':'Inativo'}</span></td>
      <td style="white-space:nowrap">
        <button class="btn ghost sm" data-tg="${p.id}">${p.ativo?'⏸':'▶'}</button>
        <button class="btn ghost sm" data-ed="${p.id}">✏️</button>
        <button class="btn danger sm" data-del="${p.id}">🗑</button></td></tr>`).join('')}
    </tbody></table>`;

  $$('#produtos-table [data-ed]').forEach(b => b.onclick =
    () => formProduto(state.prods.find(p => p.id === b.dataset.ed)));
  $$('#produtos-table [data-tg]').forEach(b => b.onclick = async () => {
    const p = state.prods.find(x => x.id === b.dataset.tg);
    await sb.from('products').update({ ativo: !p.ativo }).eq('id', p.id);
    p.ativo = !p.ativo; renderProdutos(); toast(p.ativo ? 'Produto ativado' : 'Produto pausado');
  });
  $$('#produtos-table [data-del]').forEach(b => b.onclick = async () => {
    if (!confirm('Excluir produto do cardápio?')) return;
    const { error } = await sb.from('products').delete().eq('id', b.dataset.del);
    if (error) return erro(error);
    state.prods = state.prods.filter(p => p.id !== b.dataset.del);
    renderProdutos(); toast('Produto excluído');
  });
}

function formProduto(p = null) {
  modal({
    title: p ? 'Editar produto' : 'Novo produto',
    body: `<div class="form-grid">
      <label>Nome*<input id="p-nome" value="${esc(p?.nome||'')}"></label>
      <label>Categoria<select id="p-cat">${state.cats.map(c =>
        `<option value="${c.id}" ${p?.categoria_id===c.id?'selected':''}>${esc(c.nome)}</option>`).join('')}</select></label>
      <label>Preço entrega/retirada<input id="p-pe" inputmode="decimal" value="${p?.preco_entrega??0}"></label>
      <label>Preço mesa<input id="p-pm" inputmode="decimal" value="${p?.preco_mesa??0}"></label>
      <label>Ordem<input id="p-ord" type="number" value="${p?.ordem??0}"></label>
      <label>É pizza (meio a meio)?<select id="p-pz">
        <option value="1" ${p?.is_pizza?'selected':''}>Sim</option>
        <option value="0" ${p&&!p.is_pizza?'selected':''}>Não</option></select></label>
    </div>
    <label style="margin-top:10px">Descrição / ingredientes
      <textarea id="p-desc" rows="2">${esc(p?.descricao||'')}</textarea></label>`,
    footer: `<button class="btn ghost" data-close>Cancelar</button>
             <button class="btn primary" id="p-ok">Salvar</button>`
  });
  $('#p-ok').onclick = async () => {
    const payload = { nome:$('#p-nome').value.trim(), categoria_id:Number($('#p-cat').value),
      preco_entrega:num($('#p-pe').value), preco_mesa:num($('#p-pm').value),
      ordem:Number($('#p-ord').value)||0, is_pizza:$('#p-pz').value==='1',
      descricao:$('#p-desc').value.trim() };
    if (!payload.nome) return toast('Informe o nome', 'warn');
    const { error } = p ? await sb.from('products').update(payload).eq('id', p.id)
                        : await sb.from('products').insert(payload);
    if (error) return erro(error);
    const { data } = await sb.from('products').select('*').order('ordem');
    state.prods = data; closeModal(); renderProdutos(); toast('Produto salvo');
  };
}

/* =====================================================================
   CAIXA
   ===================================================================== */
async function renderCaixa() {
  const box = $('#caixa-content');
  if (!state.caixa) {
    box.innerHTML = `<div class="box" style="max-width:420px">
      <h4>Abrir caixa</h4>
      <label>Operador<input id="cx-op" value="${esc(state.user.email)}"></label>
      <label>Valor de abertura (troco)<input id="cx-val" inputmode="decimal" value="0"></label>
      <button class="btn primary block" id="cx-abrir">Abrir caixa</button></div>`;
    $('#cx-abrir').onclick = async () => {
      const { data, error } = await sb.from('cash_sessions').insert({
        operador:$('#cx-op').value.trim(), valor_abertura:num($('#cx-val').value) }).select().single();
      if (error) return erro(error);
      state.caixa = data; toast('Caixa aberto'); render();
    };
    return;
  }
  const { data: movs } = await sb.from('cash_movements').select('*')
    .eq('session_id', state.caixa.id).order('created_at');
  const vendas = state.orders.filter(o => o.cash_session_id === state.caixa.id && o.status === 'finalizado');
  const porPg = {};
  vendas.forEach(o => porPg[o.pagamento || '-'] = (porPg[o.pagamento || '-'] || 0) + Number(o.total));
  const dinheiro = porPg['Dinheiro'] || 0;
  const supr = (movs||[]).filter(m => m.tipo==='suprimento').reduce((s,m)=>s+Number(m.valor),0);
  const sang = (movs||[]).filter(m => m.tipo==='sangria').reduce((s,m)=>s+Number(m.valor),0);
  const esperado = Number(state.caixa.valor_abertura) + dinheiro + supr - sang;
  const totalVendas = vendas.reduce((s,o)=>s+Number(o.total),0);

  box.innerHTML = `
    <div class="cards">
      <div class="kpi"><span>Aberto em</span><strong style="font-size:16px">${dataHora(state.caixa.aberto_em)}</strong></div>
      <div class="kpi"><span>Abertura</span><strong>${money(state.caixa.valor_abertura)}</strong></div>
      <div class="kpi g"><span>Vendas (${vendas.length})</span><strong>${money(totalVendas)}</strong></div>
      <div class="kpi y"><span>Dinheiro em caixa</span><strong>${money(esperado)}</strong></div>
    </div>
    <div class="box"><h4>Recebimentos por forma de pagamento</h4>
      <table><tbody>${Object.entries(porPg).length ? Object.entries(porPg).map(([k,v]) =>
        `<tr><td>${esc(k)}</td><td style="text-align:right"><b>${money(v)}</b></td></tr>`).join('')
        : '<tr><td class="muted">Nenhuma venda ainda</td></tr>'}</tbody></table></div>
    <div class="box"><h4>Movimentações</h4>
      <div class="row" style="margin-bottom:12px">
        <label class="grow">Valor<input id="mv-val" inputmode="decimal"></label>
        <label class="grow">Motivo<input id="mv-mot" placeholder="Ex.: troco, pagamento fornecedor"></label>
        <button class="btn green sm" id="mv-sup">+ Suprimento</button>
        <button class="btn yellow sm" id="mv-san">− Sangria</button>
      </div>
      <table><tbody>${(movs||[]).length ? movs.map(m =>
        `<tr><td>${hora(m.created_at)}</td><td>${m.tipo==='suprimento'?'⬆ Suprimento':'⬇ Sangria'}</td>
         <td>${esc(m.motivo)}</td><td style="text-align:right"><b>${money(m.valor)}</b></td></tr>`).join('')
        : '<tr><td class="muted">Sem movimentações</td></tr>'}</tbody></table></div>
    <button class="btn danger" id="cx-fechar">🔒 Fechar caixa</button>`;

  const mov = async tipo => {
    const v = num($('#mv-val').value);
    if (v <= 0) return toast('Informe o valor', 'warn');
    const { error } = await sb.from('cash_movements').insert({
      session_id: state.caixa.id, tipo, valor: v, motivo: $('#mv-mot').value.trim() });
    if (error) return erro(error);
    toast('Movimentação registrada'); renderCaixa();
  };
  $('#mv-sup').onclick = () => mov('suprimento');
  $('#mv-san').onclick = () => mov('sangria');

  $('#cx-fechar').onclick = () => {
    const abertas = state.orders.filter(o => o.status === 'aberto').length;
    modal({
      title: 'Fechamento de caixa',
      body: `${abertas ? `<p class="err">⚠ Existem ${abertas} conta(s) de mesa abertas.</p>` : ''}
        <div class="lin"><span>Dinheiro esperado na gaveta</span><strong>${money(esperado)}</strong></div>
        <label style="margin-top:12px">Valor contado (dinheiro)<input id="cf-val" inputmode="decimal" value="${esperado.toFixed(2)}"></label>
        <div class="lin"><span>Diferença</span><strong id="cf-dif">R$ 0,00</strong></div>`,
      footer: `<button class="btn ghost" data-close>Cancelar</button>
               <button class="btn danger" id="cf-ok">Confirmar fechamento</button>`
    });
    const dif = () => { $('#cf-dif').textContent = money(num($('#cf-val').value) - esperado); };
    $('#cf-val').oninput = dif; dif();
    $('#cf-ok').onclick = async () => {
      const v = num($('#cf-val').value);
      const { error } = await sb.from('cash_sessions').update({
        status:'fechado', valor_fechamento:v, diferenca:v-esperado,
        fechado_em:new Date().toISOString() }).eq('id', state.caixa.id);
      if (error) return erro(error);
      imprimirFechamento({ esperado, contado:v, totalVendas, porPg, supr, sang, vendas:vendas.length });
      state.caixa = null; closeModal(); toast('Caixa fechado'); render();
    };
  };
}

/* =====================================================================
   RELATÓRIOS
   ===================================================================== */
function renderRelBase() { if (!$('#rel-content').innerHTML) gerarRelatorio(); }

async function gerarRelatorio() {
  const de = $('#rel-de').value || hoje(), ate = $('#rel-ate').value || hoje();
  const ini = new Date(de + 'T00:00:00').toISOString();
  const fim = new Date(ate + 'T23:59:59').toISOString();
  const { data, error } = await sb.from('orders').select('*, order_items(*)')
    .gte('created_at', ini).lte('created_at', fim).order('created_at');
  if (error) return erro(error);

  const ok = (data||[]).filter(o => o.status === 'finalizado');
  const cancel = (data||[]).filter(o => o.status === 'cancelado');
  const fat = ok.reduce((s,o)=>s+Number(o.total),0);
  const ticket = ok.length ? fat/ok.length : 0;
  const porTipo = {}, porPg = {}, prod = {}, porDia = {};
  ok.forEach(o => {
    porTipo[LABEL_TIPO[o.tipo]] = (porTipo[LABEL_TIPO[o.tipo]]||0) + Number(o.total);
    porPg[o.pagamento||'-']     = (porPg[o.pagamento||'-']||0) + Number(o.total);
    const d = new Date(o.created_at).toLocaleDateString('pt-BR');
    porDia[d] = (porDia[d]||0) + Number(o.total);
    (o.order_items||[]).forEach(i => {
      prod[i.nome] = prod[i.nome] || { qtd:0, val:0 };
      prod[i.nome].qtd += i.qtd; prod[i.nome].val += Number(i.total);
    });
  });
  const top = Object.entries(prod).sort((a,b)=>b[1].qtd-a[1].qtd).slice(0,15);
  const tab = (obj, l1, l2) => `<table><thead><tr><th>${l1}</th><th style="text-align:right">${l2}</th></tr></thead>
    <tbody>${Object.entries(obj).length ? Object.entries(obj).map(([k,v]) =>
      `<tr><td>${esc(k)}</td><td style="text-align:right"><b>${money(v)}</b></td></tr>`).join('')
      : '<tr><td class="muted">Sem dados</td><td></td></tr>'}</tbody></table>`;

  $('#rel-content').innerHTML = `
    <div class="cards">
      <div class="kpi g"><span>Faturamento</span><strong>${money(fat)}</strong></div>
      <div class="kpi"><span>Pedidos finalizados</span><strong>${ok.length}</strong></div>
      <div class="kpi b"><span>Ticket médio</span><strong>${money(ticket)}</strong></div>
      <div class="kpi y"><span>Cancelados</span><strong>${cancel.length}</strong></div>
    </div>
    <div class="box"><h4>Faturamento por dia</h4>${tab(porDia,'Dia','Total')}</div>
    <div class="box"><h4>Por canal de venda</h4>${tab(porTipo,'Canal','Total')}</div>
    <div class="box"><h4>Por forma de pagamento</h4>${tab(porPg,'Forma','Total')}</div>
    <div class="box"><h4>Produtos mais vendidos</h4>
      <table><thead><tr><th>#</th><th>Produto</th><th>Qtd</th><th style="text-align:right">Total</th></tr></thead>
      <tbody>${top.length ? top.map(([n,v],i) =>
        `<tr><td>${i+1}º</td><td>${esc(n)}</td><td>${v.qtd}</td>
         <td style="text-align:right"><b>${money(v.val)}</b></td></tr>`).join('')
        : '<tr><td class="muted" colspan="4">Sem dados</td></tr>'}</tbody></table></div>`;
}

/* =====================================================================
   CONFIGURAÇÕES
   ===================================================================== */
function renderConfig() {
  const s = state.settings;
  $('#config-content').innerHTML = `
    <div class="box"><h4>Dados da loja</h4>
      <div class="form-grid">
        <label>Nome<input id="s-nome" value="${esc(s.nome_loja||'')}"></label>
        <label>Telefone<input id="s-tel" value="${esc(s.telefone||'')}"></label>
        <label>Endereço<input id="s-end" value="${esc(s.endereco||'')}"></label>
        <label>Taxa de entrega padrão<input id="s-taxa" inputmode="decimal" value="${s.taxa_entrega_padrao??0}"></label>
        <label>Taxa de serviço (%)<input id="s-serv" inputmode="decimal" value="${s.taxa_servico_percent??0}"></label>
        <label>Tempo de preparo (min)<input id="s-tp" type="number" value="${s.tempo_preparo??40}"></label>
      </div>
      <label style="margin-top:10px">Mensagem do cupom<input id="s-msg" value="${esc(s.mensagem_cupom||'')}"></label>
      <button class="btn primary" id="s-ok" style="margin-top:12px">Salvar configurações</button></div>

    <div class="box"><h4>Bairros e taxas de entrega</h4>
      <div class="row" style="margin-bottom:12px">
        <label class="grow">Bairro<input id="b-nome"></label>
        <label class="grow">Taxa<input id="b-taxa" inputmode="decimal"></label>
        <button class="btn green sm" id="b-add">+ Adicionar</button></div>
      <table><tbody>${state.bairros.map(b => `<tr><td>${esc(b.nome)}</td>
        <td style="text-align:right">${money(b.taxa)}</td>
        <td style="width:50px"><button class="btn danger sm" data-bd="${b.id}">🗑</button></td></tr>`).join('')}
      </tbody></table></div>

    <div class="box"><h4>Pedidos</h4>
      <p class="muted" style="margin-bottom:12px">Zere a numeração dos pedidos para recomeçar do #1. Esta ação não apaga vendas antigas.</p>
      <button class="btn danger" id="reset-pedidos">🔄 Reiniciar numeração de pedidos</button></div>`;

  $('#s-ok').onclick = async () => {
    const p = { nome_loja:$('#s-nome').value.trim(), telefone:$('#s-tel').value.trim(),
      endereco:$('#s-end').value.trim(), taxa_entrega_padrao:num($('#s-taxa').value),
      taxa_servico_percent:num($('#s-serv').value), tempo_preparo:Number($('#s-tp').value)||40,
      mensagem_cupom:$('#s-msg').value.trim() };
    const { error } = await sb.from('settings').update(p).eq('id', 1);
    if (error) return erro(error);
    state.settings = { ...state.settings, ...p };
    $('#store-name').textContent = p.nome_loja; toast('Configurações salvas');
  };
  $('#b-add').onclick = async () => {
    const nome = $('#b-nome').value.trim();
    if (!nome) return toast('Informe o bairro', 'warn');
    const { error } = await sb.from('neighborhoods').insert({ nome, taxa:num($('#b-taxa').value) });
    if (error) return erro(error);
    const { data } = await sb.from('neighborhoods').select('*').order('nome');
    state.bairros = data; renderConfig(); toast('Bairro adicionado');
  };
  $$('[data-bd]').forEach(b => b.onclick = async () => {
    await sb.from('neighborhoods').delete().eq('id', b.dataset.bd);
    state.bairros = state.bairros.filter(x => x.id != b.dataset.bd);
    renderConfig(); toast('Bairro removido');
  });
  $('#reset-pedidos').onclick = async () => {
    if (!confirm('Reiniciar numeração de pedidos?\n\nOs pedidos antigos continuarão salvos no histórico, mas a numeração voltará para #1.')) return;
    try {
      const { error } = await sb.rpc('reset_pedidos');
      if (error) throw error;
      await loadOrders();
      toast('Numeração reiniciada! Próximo pedido será #1');
    } catch (e) {
      console.error('Erro ao resetar pedidos:', e);
      const msg = (e && e.message) ? e.message : 'Erro ao reiniciar numeração';
      const is404 = msg.includes('404') || msg.includes('Could not find the function') || msg.includes('Not Found');
      const is400 = msg.includes('UPDATE requires a WHERE clause') || msg.includes('400');
      if (is404 || is400) {
        alert('A função reset_pedidos precisa ser recriada no banco.\n\n' +
          'Execute este SQL no SQL Editor do Supabase:\n\n' +
          'CREATE OR REPLACE FUNCTION public.reset_pedidos()\n' +
          'RETURNS void\n' +
          'LANGUAGE plpgsql\n' +
          'SECURITY DEFINER\n' +
          'AS $$\n' +
          'DECLARE\n' +
          '  max_num int;\n' +
          'BEGIN\n' +
          '  SELECT COALESCE(MAX(numero), 0) INTO max_num FROM public.orders;\n' +
          '  IF max_num = 0 THEN RETURN; END IF;\n' +
          '  UPDATE public.orders SET numero = numero + 100000 WHERE true;\n' +
          '  ALTER SEQUENCE orders_numero_seq RESTART WITH 1;\n' +
          'END;\n' +
          '$$;\n\n' +
          'GRANT EXECUTE ON FUNCTION public.reset_pedidos() TO anon;\n' +
          'GRANT EXECUTE ON FUNCTION public.reset_pedidos() TO authenticated;');
      } else {
        toast(msg, 'err');
      }
    }
  };
}

/* =====================================================================
   IMPRESSÃO (80mm)
   ===================================================================== */
function printNow(html) {
  $('#print-area').innerHTML = html;
  window.print();
}
function imprimirCupom(o, parcial = false) {
  const s = state.settings;
  const mesa = o.mesa_id ? state.tables.find(t => t.id === o.mesa_id)?.numero : null;
  const itens = (o.order_items || []);
  printNow(`
    <h2>${esc(s.nome_loja||'Eri Lanches')}</h2>
    <div class="c">${esc(s.endereco||'')}<br>${esc(s.telefone||'')}</div>
    <div class="hr"></div>
    <div class="c"><b>${parcial ? 'CONFERÊNCIA (NÃO FISCAL)' : 'CUPOM NÃO FISCAL'}</b></div>
    <div>Pedido: #${o.numero}</div>
    <div>Data: ${dataHora(o.created_at)}</div>
    <div>Tipo: ${LABEL_TIPO[o.tipo]}${mesa ? ' '+mesa : ''}</div>
    ${o.cliente_nome ? `<div>Cliente: ${esc(o.cliente_nome)}</div>` : ''}
    ${o.cliente_telefone ? `<div>Fone: ${esc(o.cliente_telefone)}</div>` : ''}
    ${o.endereco ? `<div>End.: ${esc(o.endereco)}</div>` : ''}
    <div class="hr"></div>
    <table>${itens.map(i => `
      <tr><td>${i.qtd}x ${esc(i.nome)}</td><td style="text-align:right">${money(i.total)}</td></tr>
      ${i.observacao ? `<tr><td colspan="2">  * ${esc(i.observacao)}</td></tr>` : ''}`).join('')}
    </table>
    <div class="hr"></div>
    <table>
      <tr><td>Subtotal</td><td style="text-align:right">${money(o.subtotal)}</td></tr>
      ${Number(o.desconto) ? `<tr><td>Desconto</td><td style="text-align:right">-${money(o.desconto)}</td></tr>`:''}
      ${Number(o.taxa_entrega) ? `<tr><td>Entrega</td><td style="text-align:right">${money(o.taxa_entrega)}</td></tr>`:''}
      ${Number(o.taxa_servico) ? `<tr><td>Serviço</td><td style="text-align:right">${money(o.taxa_servico)}</td></tr>`:''}
      <tr class="tot"><td>TOTAL</td><td style="text-align:right">${money(o.total)}</td></tr>
      ${o.pagamento ? `<tr><td>Pgto</td><td style="text-align:right">${esc(o.pagamento)}</td></tr>`:''}
      ${Number(o.troco) ? `<tr><td>Troco</td><td style="text-align:right">${money(o.troco)}</td></tr>`:''}
    </table>
    ${o.observacao ? `<div class="hr"></div><div>Obs: ${esc(o.observacao)}</div>` : ''}
    <div class="hr"></div>
    <div class="c">${esc(s.mensagem_cupom||'')}</div>`);
}
function imprimirComanda(conta, itens) {
  const mesa = state.tables.find(t => t.id === conta.mesa_id)?.numero;
  printNow(`<h2>COMANDA COZINHA</h2>
    <div class="c">Pedido #${conta.numero} — Mesa ${mesa}</div>
    <div class="c">${new Date().toLocaleString('pt-BR')}</div>
    <div class="hr"></div>
    <table>${itens.map(i => `<tr><td><b>${i.qtd}x</b> ${esc(i.nome)}</td></tr>
      ${i.obs ? `<tr><td>  * ${esc(i.obs)}</td></tr>` : ''}`).join('')}</table>
    <div class="hr"></div>`);
}
function imprimirFechamento(r) {
  printNow(`<h2>FECHAMENTO DE CAIXA</h2>
    <div class="c">${dataHora(new Date())}</div>
    <div class="hr"></div>
    <table>
      <tr><td>Pedidos finalizados</td><td style="text-align:right">${r.vendas}</td></tr>
      <tr><td>Total vendido</td><td style="text-align:right">${money(r.totalVendas)}</td></tr>
      <tr><td>Suprimentos</td><td style="text-align:right">${money(r.supr)}</td></tr>
      <tr><td>Sangrias</td><td style="text-align:right">-${money(r.sang)}</td></tr>
    </table><div class="hr"></div>
    <table>${Object.entries(r.porPg).map(([k,v]) =>
      `<tr><td>${esc(k)}</td><td style="text-align:right">${money(v)}</td></tr>`).join('')}</table>
    <div class="hr"></div>
    <table>
      <tr><td>Esperado (gaveta)</td><td style="text-align:right">${money(r.esperado)}</td></tr>
      <tr><td>Contado</td><td style="text-align:right">${money(r.contado)}</td></tr>
      <tr class="tot"><td>Diferença</td><td style="text-align:right">${money(r.contado - r.esperado)}</td></tr>
    </table><div class="hr"></div>
    <div class="c">Conferido por: ______________________</div>`);
}