import React from 'react';
import { useTranslation } from '../../hooks/useTranslation';

const Panel = () => {
    const { t } = useTranslation();
    return (
        <div className="container">
            <h1>{t('panel.title')}</h1>
            <div>
               {t('panel.waiting')}
            </div>
        </div>
    );
};

export default Panel;