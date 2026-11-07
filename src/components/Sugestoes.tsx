import { useMemo, useState } from 'react';
import { Button, Modal, MoneyInput } from '../ui/ui';
import { formatBRL, formatPercent } from '../core/money';

export interface Sugestao {
  id: string;
  nome: string;
  unidade: string;
  atual: number | null;
  sugerido: number;
}

/**
 * Revisão de preços sugeridos: nada é alterado até a pessoa marcar os produtos e confirmar.
 * Preços de venda definidos manualmente continuam como estão, a menos que sejam marcados aqui.
 */
export function Sugestoes({
  itens,
  semCusto,
  rotulo,
  onApply,
  onClose,
}: {
  itens: Sugestao[];
  semCusto: number;
  rotulo: string;
  onApply: (itens: { id: string; venda: number }[]) => void;
  onClose: () => void;
}) {
  const diferentes = useMemo(() => itens.filter((i) => i.atual !== i.sugerido), [itens]);
  const iguais = itens.length - diferentes.length;
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [valores, setValores] = useState<Record<string, number | null>>(() => Object.fromEntries(itens.map((i) => [i.id, i.sugerido])));

  const toggle = (id: string) =>
    setMarcados((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  const aplicaveis = diferentes.filter((i) => marcados.has(i.id) && (valores[i.id] ?? 0) > 0);

  return (
    <Modal
      open
      wide
      title="Preços sugeridos"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            icon="check"
            disabled={aplicaveis.length === 0}
            onClick={() => {
              onApply(aplicaveis.map((i) => ({ id: i.id, venda: valores[i.id]! })));
              onClose();
            }}
          >
            Aplicar {aplicaveis.length} preço{aplicaveis.length === 1 ? '' : 's'}
          </Button>
        </>
      }
    >
      <p className="muted">
        Sugestão com as premissas atuais ({rotulo}). Marque só os produtos que quer atualizar; você pode ajustar o valor de cada um. Os demais ficam como estão.
      </p>
      <div className="row-gap wrap">
        <Button variant="ghost" onClick={() => setMarcados(new Set(diferentes.map((i) => i.id)))}>
          Marcar todos
        </Button>
        <Button variant="ghost" onClick={() => setMarcados(new Set(diferentes.filter((i) => i.atual != null && i.atual < i.sugerido).map((i) => i.id)))}>
          Só os abaixo do sugerido
        </Button>
        <Button variant="ghost" onClick={() => setMarcados(new Set())}>
          Limpar
        </Button>
      </div>
      <div className="table-card">
        <table className="table">
          <thead>
            <tr>
              <th className="c-check">
                <span className="sr-only">Marcar</span>
              </th>
              <th>Produto</th>
              <th className="num">Preço atual</th>
              <th className="num">Sugerido</th>
              <th className="num">Variação</th>
              <th className="num">Aplicar</th>
            </tr>
          </thead>
          <tbody>
            {diferentes.map((i) => {
              const v = i.atual != null && i.atual > 0 ? ((i.sugerido - i.atual) / i.atual) * 100 : null;
              return (
                <tr key={i.id} className={marcados.has(i.id) ? 'selected' : ''}>
                  <td className="c-check">
                    <input type="checkbox" aria-label={`Atualizar ${i.nome}`} checked={marcados.has(i.id)} onChange={() => toggle(i.id)} />
                  </td>
                  <td className="strong">
                    {i.nome} <small className="muted">/ {i.unidade}</small>
                  </td>
                  <td className="num muted">{formatBRL(i.atual)}</td>
                  <td className="num">{formatBRL(i.sugerido)}</td>
                  <td className="num">{v == null ? '—' : `${v > 0 ? '+' : ''}${formatPercent(v, 1)}`}</td>
                  <td className="num">
                    <MoneyInput ariaLabel={`Valor a aplicar em ${i.nome}`} allowEmpty={false} value={valores[i.id] ?? null} onChange={(c) => setValores((o) => ({ ...o, [i.id]: c }))} />
                  </td>
                </tr>
              );
            })}
            {diferentes.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  Todos os preços já estão iguais ao sugerido.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        {iguais > 0 && `${iguais} produto${iguais === 1 ? '' : 's'} já está${iguais === 1 ? '' : 'o'} no preço sugerido. `}
        {semCusto > 0 && `${semCusto} sem custo cadastrado não aparece${semCusto === 1 ? '' : 'm'}.`}
      </p>
    </Modal>
  );
}
