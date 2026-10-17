/* 账号：手机号注册 / 登录。
   这是一个「纯前端、无后端」的本地演示实现：账号存在 localStorage 里，
   未登录时以「游客」身份访问，数据也存在本机。
   ⚠️ 说明：这里的哈希只是为了不把明文字符串直接摆在那里，不是密码学安全的做法，
   真实产品的密码必须由服务端加盐慢哈希保存。 */
(function (global) {
  'use strict';

  var ACC_KEY = 'quizmvp.accounts';
  var CUR_KEY = 'quizmvp.current';
  var CODE_TTL = 10 * 60 * 1000;

  function readJSON(key, fallback) {
    try {
      var raw = global.localStorage.getItem(key);
      if (!raw) return fallback;
      var value = JSON.parse(raw);
      return value && typeof value === 'object' ? value : fallback;
    } catch (err) { return fallback; }
  }

  function writeJSON(key, value) {
    try { global.localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (err) { return false; }
  }

  function accounts() { return readJSON(ACC_KEY, {}); }

  /** 本地演示哈希（FNV-1a 变体），只为避免明文存储 */
  function hash(text) {
    var h1 = 0x811c9dc5 >>> 0;
    var h2 = 0x9e3779b9 >>> 0;
    for (var i = 0; i < text.length; i += 1) {
      var c = text.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
      h2 = (Math.imul(h2 + c + i, 2246822519) ^ (h2 >>> 13)) >>> 0;
    }
    return ('0000000' + h1.toString(16)).slice(-8) + ('0000000' + h2.toString(16)).slice(-8);
  }

  function normalizePhone(value) { return String(value == null ? '' : value).replace(/\D/g, '').slice(0, 11); }
  function isPhone(value) { return /^1[3-9]\d{9}$/.test(normalizePhone(value)); }
  function maskPhone(value) {
    var p = normalizePhone(value);
    return p.length === 11 ? p.slice(0, 3) + '****' + p.slice(7) : p;
  }

  var pending = { phone: '', code: '', at: 0 };

  function current() {
    var phone = normalizePhone(global.localStorage.getItem(CUR_KEY) || '');
    var acc = phone ? accounts()[phone] : null;
    if (!acc) return { isGuest: true, id: 'guest', nickname: '游客', phone: '' };
    return {
      isGuest: false,
      id: 'u_' + acc.phone,
      nickname: acc.nickname || '同学',
      phone: acc.phone,
      createdAt: acc.createdAt || 0,
    };
  }

  /** 每个身份一份独立数据：游客和每个账号互不干扰 */
  function ownerKey() {
    var me = current();
    return me.isGuest ? 'guest' : me.id;
  }

  /** 演示用“发验证码”：真实产品这里调短信服务，本站直接把 6 位码显示出来 */
  function sendCode(phone) {
    var p = normalizePhone(phone);
    if (!isPhone(p)) return { ok: false, error: '请输入 11 位手机号' };
    var code = String(Math.floor(100000 + Math.random() * 900000));
    pending = { phone: p, code: code, at: Date.now() };
    return { ok: true, phone: p, code: code };
  }

  function register(input) {
    var phone = normalizePhone(input && input.phone);
    var password = String((input && input.password) || '');
    var code = String((input && input.code) || '').trim();
    var nickname = String((input && input.nickname) || '').trim();

    if (!isPhone(phone)) return { ok: false, error: '请输入 11 位手机号' };
    if (!pending.code || pending.phone !== phone || Date.now() - pending.at > CODE_TTL) {
      return { ok: false, error: '请先点「获取验证码」' };
    }
    if (code !== pending.code) return { ok: false, error: '验证码不对，请重新输入' };
    if (password.length < 6) return { ok: false, error: '密码至少 6 位' };

    var all = accounts();
    if (all[phone]) return { ok: false, error: '这个手机号已经注册过了，直接登录吧' };

    var salt = Math.random().toString(36).slice(2) + Date.now().toString(36);
    all[phone] = {
      phone: phone,
      nickname: nickname || ('同学' + phone.slice(-4)),
      salt: salt,
      pass: hash(salt + ':' + password),
      createdAt: Date.now(),
    };
    if (!writeJSON(ACC_KEY, all)) return { ok: false, error: '浏览器不允许写入本地存储' };
    pending = { phone: '', code: '', at: 0 };
    try { global.localStorage.setItem(CUR_KEY, phone); } catch (err) { /* ignore */ }
    return { ok: true, account: current() };
  }

  function login(input) {
    var phone = normalizePhone(input && input.phone);
    var password = String((input && input.password) || '');
    if (!isPhone(phone)) return { ok: false, error: '请输入 11 位手机号' };
    var acc = accounts()[phone];
    if (!acc) return { ok: false, error: '这个手机号还没注册，先去注册吧' };
    if (hash(acc.salt + ':' + password) !== acc.pass) return { ok: false, error: '密码不对' };
    try { global.localStorage.setItem(CUR_KEY, phone); } catch (err) { /* ignore */ }
    return { ok: true, account: current() };
  }

  function logout() {
    try { global.localStorage.removeItem(CUR_KEY); } catch (err) { /* ignore */ }
    return current();
  }

  global.Auth = {
    current: current,
    ownerKey: ownerKey,
    isPhone: isPhone,
    maskPhone: maskPhone,
    sendCode: sendCode,
    register: register,
    login: login,
    logout: logout,
    accounts: accounts,
  };
})(window);
