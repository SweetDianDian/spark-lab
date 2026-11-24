import type { ReactNode } from 'react';
import { Modal } from 'antd';

export default function Dialog({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  return <Modal title={title} open onCancel={onClose} footer={null} width={wide ? 960 : 600} centered destroyOnHidden mask={{ closable: true }}>{children}</Modal>;
}
