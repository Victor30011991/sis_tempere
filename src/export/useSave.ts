import { useCallback } from 'react';
import { useApp } from '../state/store';
import { useFeedback } from '../ui/feedback';
import { downloadBlob } from '../ui/ui';
import { slug } from '../core/normalize';

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Salva a lista inteira (produtos + configurações) num arquivo Excel. O arquivo é a sua base de dados. */
export function useSaveExcel() {
  const { state, act } = useApp();
  const { toast } = useFeedback();
  return useCallback(async () => {
    try {
      const { buildWorkbook } = await import('./excel');
      const buf = await buildWorkbook(state.lista, state.loja, state.config);
      const date = new Date().toISOString().slice(0, 10);
      downloadBlob(buf, `${slug(state.lista.nome)}-${date}.xlsx`, XLSX_MIME);
      act.salvo();
      toast('Arquivo Excel gerado. Guarde-o: é com ele que você continua a lista depois.');
    } catch (e) {
      toast(`Não foi possível gerar o Excel: ${e instanceof Error ? e.message : 'erro desconhecido'}`, 'erro');
    }
  }, [state.lista, state.loja, state.config, act, toast]);
}
