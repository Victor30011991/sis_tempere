import { useMemo, useState } from 'react';
import type { Product } from '../types';
import { formatBRL, parseMoney, parseNumberBR } from '../core/money';
import { norm } from '../core/normalize';
import { counterBasis, formatCounterQty, quantityForValue, valueForQuantity } from '../core/units';

type Modo = 'valor' | 'peso';

/** Conversor rápido de balcão: "R$ 10 de açafrão" -> peso, ou "250 g" -> preço. Só lê os produtos, não altera nada. */
export function Balcao({ produtos }: { produtos: Product[] }) {
  const [q, setQ] = useState('');
  const [id, setId] = useState('');
  const [modo, setModo] = useState<Modo>('valor');
  const [entrada, setEntrada] = useState('');
  const [grande, setGrande] = useState(false); // kg / L em vez de g / ml

  const opcoes = useMemo(() => {
    const nq = norm(q);
    return produtos
      .filter((p) => counterBasis(p) != null && (!nq || norm(p.nome).includes(nq)))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }, [produtos, q]);

  const prod = produtos.find((p) => p.id === id) ?? null;
  const basis = prod ? counterBasis(prod) : null;
  const medida = basis && (basis.base === 'g' || basis.base === 'ml');
  const unGrande = basis?.base === 'g' ? 'kg' : 'L';

  let resultado: string | null = null;
  let detalhe: string | null = null;
  if (prod && basis && entrada.trim()) {
    if (modo === 'valor') {
      const c = parseMoney(entrada);
      if (c != null && c > 0) {
        resultado = formatCounterQty(quantityForValue(c, basis), basis.base);
        detalhe = `${formatBRL(c)} de ${prod.nome}`;
      }
    } else {
      const n = parseNumberBR(entrada);
      if (n != null && n > 0) {
        const emBase = medida && grande ? n * 1000 : n;
        resultado = formatBRL(valueForQuantity(emBase, basis));
        detalhe = `${formatCounterQty(emBase, basis.base)} de ${prod.nome}`;
      }
    }
  }
  const atalhos = medida ? [50, 100, 250, 500, 1000] : [1, 2, 5, 10];

  return (
    <section className="card balcao" aria-label="Conversor de balcão">
      <div className="balcao-top">
        <h2>Balcão</h2>
        <div className="seg" role="group" aria-label="O que o cliente pediu">
          <button type="button" className={modo === 'valor' ? 'on' : ''} aria-pressed={modo === 'valor'} onClick={() => { setModo('valor'); setEntrada(''); }}>
            Pediu um valor (R$)
          </button>
          <button type="button" className={modo === 'peso' ? 'on' : ''} aria-pressed={modo === 'peso'} onClick={() => { setModo('peso'); setEntrada(''); }}>
            Pediu uma quantidade
          </button>
        </div>
      </div>
      <div className="balcao-row">
        <label className="inline-label">
          Produto
          <input type="search" placeholder="Buscar" aria-label="Buscar produto no balcão" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <select aria-label="Produto do balcão" value={id} onChange={(e) => { setId(e.target.value); setGrande(false); }}>
          <option value="">Escolha o produto…</option>
          {opcoes.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nome} · {formatBRL(p.venda)}/{p.unidade}
            </option>
          ))}
        </select>
        <label className="inline-label">
          {modo === 'valor' ? 'Valor' : 'Quantidade'}
          <input
            inputMode="decimal"
            aria-label={modo === 'valor' ? 'Valor em reais' : 'Quantidade'}
            placeholder={modo === 'valor' ? 'Ex.: 10,00' : 'Ex.: 250'}
            value={entrada}
            onChange={(e) => setEntrada(e.target.value)}
            disabled={!prod}
          />
        </label>
        {modo === 'peso' && medida && (
          <select aria-label="Unidade da quantidade" value={grande ? 'g' : 'p'} onChange={(e) => setGrande(e.target.value === 'g')}>
            <option value="p">{basis!.base}</option>
            <option value="g">{unGrande}</option>
          </select>
        )}
        {modo === 'peso' && !medida && basis && <span className="muted">{basis.base}</span>}
      </div>
      {modo === 'peso' && prod && (
        <div className="balcao-presets">
          {atalhos.map((a) => (
            <button
              key={a}
              type="button"
              className="chip"
              onClick={() => {
                if (medida && a === 1000) {
                  setGrande(true);
                  setEntrada('1');
                } else {
                  setGrande(false);
                  setEntrada(String(a));
                }
              }}
            >
              {medida ? (a === 1000 ? `1 ${unGrande}` : `${a} ${basis!.base}`) : `${a} ${basis!.base}`}
            </button>
          ))}
        </div>
      )}
      <div className="balcao-out" aria-live="polite">
        {resultado ? (
          <>
            <strong>{resultado}</strong>
            <span className="muted">{detalhe}</span>
          </>
        ) : (
          <span className="muted">{prod ? 'Digite o valor ou a quantidade.' : 'Escolha um produto com preço de venda.'}</span>
        )}
      </div>
    </section>
  );
}
