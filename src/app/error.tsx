'use client';

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) { return <main className="page auth-page"><section><small>ОШИБКА</small><h1>ЧТО-ТО<br />ПОШЛО НЕ ТАК</h1><p className="subtitle">Обновите страницу или повторите попытку.</p><button className="cta" type="button" onClick={reset}><span>Повторить</span><i className="icon ph ph-arrow-right" /></button></section></main>; }
