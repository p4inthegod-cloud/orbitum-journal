/* Optional libraries never block HTML parsing or the public market workspace. */
(function () {
  const flights = new Map();
  const libraries = {
    supabase: ['https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2', 'https://unpkg.com/@supabase/supabase-js@2'],
    XLSX: ['https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js', 'https://unpkg.com/xlsx@0.18.5/dist/xlsx.full.min.js'],
    html2canvas: ['https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js', 'https://unpkg.com/html2canvas@1.4.1/dist/html2canvas.min.js']
  };
  window.journalLoadLibrary = function (name) {
    if (window[name]) return Promise.resolve(window[name]);
    if (flights.has(name)) return flights.get(name);
    const task = (async () => {
      for (const url of libraries[name] || []) {
        try {
          await new Promise((resolve, reject) => {
            const script = document.createElement('script');
            const finish = error => { clearTimeout(timer); script.onload = script.onerror = null; if (error) { script.remove(); reject(error); } else resolve(); };
            const timer = setTimeout(() => finish(new Error('Загрузка модуля заняла слишком много времени')), 4000);
            script.src = url; script.async = true;
            script.onload = () => finish(window[name] ? null : new Error('Модуль не загрузился'));
            script.onerror = () => finish(new Error('Источник модуля недоступен'));
            document.head.append(script);
          });
          return window[name];
        } catch (_) { if (window[name]) return window[name]; }
      }
      throw new Error('Не удалось загрузить модуль. Проверьте соединение и повторите попытку.');
    })();
    flights.set(name, task);
    task.catch(() => flights.delete(name));
    return task;
  };
  let demo = new URLSearchParams(location.search).get('demo') === '1';
  try { demo ||= localStorage.getItem('orb_demo_mode') === '1'; } catch (_) {}
  if (!demo) journalLoadLibrary('supabase').catch(() => {});
})();
