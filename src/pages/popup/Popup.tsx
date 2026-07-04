import React, { useState, useEffect, useCallback } from 'react';
import { CompactPicker } from 'react-color';
import Icon128 from '../../utils/images/icon-128.png';
import './index.scss';
import { Avatar, Switch, Slider, Divider, List, Button, Popconfirm, Tooltip } from 'antd';
import {
  SettingFilled,
  ReloadOutlined,
  GithubFilled
} from '@ant-design/icons';
import { useTranslation } from '../../hooks/useTranslation';

const colors = [
  'transparent',
  '#4D4D4D',
  '#999999',
  '#FFFFFF',
  '#F44E3B',
  '#FE9200',
  '#FCDC00',
  '#DBDF00',
  '#A4DD00',
  '#68CCCA',
  '#73D8FF',
  '#AEA1FF',
  '#FDA1FF',
  '#333333',
  '#808080',
  '#cccccc',
  '#D33115',
  '#E27300',
  '#FCC400',
  '#B0BC00',
  '#68BC00',
  '#16A5A5',
  '#009CE0',
  '#7B64FF',
  '#FA28FF',
  '#000000',
  '#666666',
  '#B3B3B3',
  '#9F0500',
  '#C45100',
  '#FB9E00',
  '#808900',
  '#194D33',
  '#0C797D',
  '#0062B1',
  '#653294',
  '#AB149E',
];

const DEFAULTS = {
  status: false,
  backgroundColor: '#000000',
  backgroundOpacity: 1,
  originFontSize: 22,
  originFontColor: '#ffffff',
  originFontWeight: 700,
  translatedFontSize: 28,
  translatedFontColor: '#ffffff',
  translatedFontWeight: 700,
}

const Popup = () => {
  const { t } = useTranslation()
  const [status, setStatus] = useState(false)
  const [backgroundColor, setBackgroundColor] = useState('#000000')
  const [backgroundOpacity, setBackgroundOpacity] = useState(1)
  const [originFontSize, setOriginFontSize] = useState(22)
  const [originFontColor, setOriginColor] = useState('#ffffff')
  const [originFontWeight, setOriginFontWeight] = useState(700)
  const [translatedFontSize, setTranslatedFontSize] = useState(28)
  const [translatedFontColor, setTranslatedFontColor] = useState('#ffffff')
  const [translatedFontWeight, setTranslatedFontWeight] = useState(700)
  const [diagStatus, setDiagStatus] = useState<
    'connected' | 'cors_blocked' | 'unreachable' | 'auth_error' | 'not_found' | 'timeout' | 'unknown' | null
  >(null)

  useEffect(() => {
    chrome.storage.local.get(null, function (data) {
      console.log(`popup page `, data)
      setStatus(data?.status)
      setBackgroundColor(data?.backgroundColor)
      setBackgroundOpacity(data?.backgroundOpacity)
      setOriginFontSize(data?.originFontSize)
      setOriginColor(data?.originFontColor)
      setOriginFontWeight(data?.originFontWeight)
      setTranslatedFontSize(data?.translatedFontSize)
      setTranslatedFontColor(data?.translatedFontColor)
      setTranslatedFontWeight(data?.translatedFontWeight)
      if (data?.lastDiagnostic?.status) {
        setDiagStatus(data.lastDiagnostic.status)
      }
    })
  }, []);

  const Setting = useCallback(() => {
    chrome.tabs.query(
      { active: true, currentWindow: true },
      function () {
        chrome.runtime.openOptionsPage();
      },
    );
  }, []);

  const resetAll = useCallback(() => {
    chrome.storage.local.set({ ...DEFAULTS }, () => {
      setStatus(DEFAULTS.status)
      setBackgroundColor(DEFAULTS.backgroundColor)
      setBackgroundOpacity(DEFAULTS.backgroundOpacity)
      setOriginFontSize(DEFAULTS.originFontSize)
      setOriginColor(DEFAULTS.originFontColor)
      setOriginFontWeight(DEFAULTS.originFontWeight)
      setTranslatedFontSize(DEFAULTS.translatedFontSize)
      setTranslatedFontColor(DEFAULTS.translatedFontColor)
      setTranslatedFontWeight(DEFAULTS.translatedFontWeight)
    })
  }, [])

  return (
    <div>
      <div className={'header'}>
        <div className={'left'}>
          <Avatar style={{ verticalAlign: 'middle' }} src={Icon128} />
          <div className={'brand'}>{t('popup.brand')}</div>
        </div>
        <div className={'right'}>
          {diagStatus && (
            <Tooltip title={t('popup.status.tooltip')}>
              <span
                onClick={Setting}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '2px 8px',
                  borderRadius: '10px',
                  fontSize: '11px',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  backgroundColor:
                    diagStatus === 'connected' ? '#f6ffed' :
                    diagStatus === 'cors_blocked' || diagStatus === 'timeout' ? '#fffbe6' :
                    '#fff2f0',
                  color:
                    diagStatus === 'connected' ? '#52c41a' :
                    diagStatus === 'cors_blocked' || diagStatus === 'timeout' ? '#faad14' :
                    '#ff4d4f',
                  border:
                    diagStatus === 'connected' ? '1px solid #b7eb8f' :
                    diagStatus === 'cors_blocked' || diagStatus === 'timeout' ? '1px solid #ffe58f' :
                    '1px solid #ffccc7',
                }}
              >
                <span style={{ fontSize: '10px' }}>●</span>
                {diagStatus === 'connected' ? t('popup.status.connected') : t('popup.status.error')}
              </span>
            </Tooltip>
          )}
          <SettingFilled
            title={t('popup.settings.title')}
            onClick={Setting}
            style={{ fontSize: '22px', cursor: 'pointer' }}
          />
        </div>
      </div>
      <Divider style={{ padding: 0, margin: 0 }} />

      <div className={'content'}>
        <Switch
          checkedChildren={t('popup.switch.on')}
          unCheckedChildren={t('popup.switch.off')}
          checked={status}
          onChange={(e: any) => {
            setStatus(!status)
            chrome.storage.local.set({ status: !status })
          }}
        />
        <Popconfirm
          title={t('popup.reset.confirm')}
          okText={t('popup.reset.ok')}
          cancelText={t('popup.reset.cancel')}
          onConfirm={resetAll}
        >
          <Button
            size="small"
            icon={<ReloadOutlined />}
            style={{ marginLeft: '12px' }}
          >
            {t('popup.reset.button')}
          </Button>
        </Popconfirm>
      </div>

      <List>
        <List.Item className={'flex'}>
          <span className={'label'}>{t('popup.label.bgColor')}</span>
          <CompactPicker
            colors={colors}
            color={backgroundColor}
            onChangeComplete={(color) => {
              setBackgroundColor(color?.hex)
              chrome.storage.local.set({ backgroundColor: color.hex })
            }}
            className={'CompactPicker'}
          />
        </List.Item>
        <List.Item className={'flex'}>
          <span className={'label'}>{t('popup.label.bgOpacity')}</span>
          <Slider
            className={'control'}
            min={0}
            max={1}
            step={0.1}
            onChange={(value: any) => {
              setBackgroundOpacity(value)
              chrome.storage.local.set({ backgroundOpacity: value })
            }}
            value={backgroundOpacity}
          />
        </List.Item>
        <List.Item className={'flex'}>
          <span className={'label'}>{t('popup.label.originSize')}</span>
          <Slider
            className={'control'}
            onChange={(value: any) => {
              setOriginFontSize(value)
              chrome.storage.local.set({ originFontSize: value })
            }}
            value={originFontSize}
          />
        </List.Item>
        <List.Item className={'flex'}>
          <span className={'label'}>{t('popup.label.originColor')}</span>
          <CompactPicker
            color={originFontColor}
            onChangeComplete={(color) => {
              setOriginColor(color.hex)
              chrome.storage.local.set({ originFontColor: color.hex })
            }}
            className={'CompactPicker'}
          />
        </List.Item>
        <List.Item className={'flex'}>
          <span className={'label'}>{t('popup.label.originWeight')}</span>
          <Slider
            className={'control'}
            min={100}
            max={700}
            step={100}
            onChange={(value: any) => {
              setOriginFontWeight(value)
              chrome.storage.local.set({ originFontWeight: value })
            }}
            value={originFontWeight}
          />
        </List.Item>
        <List.Item className={'flex'}>
          <span className={'label'}>{t('popup.label.translatedSize')}</span>
          <Slider
            className={'control'}
            onChange={(value: any) => {
              setTranslatedFontSize(value)
              chrome.storage.local.set({ translatedFontSize: value })
            }}
            value={translatedFontSize}
          />
        </List.Item>
        <List.Item className={'flex'}>
          <span className={'label'}>{t('popup.label.translatedColor')}</span>
          <CompactPicker
            onChangeComplete={(color) => {
              setTranslatedFontColor(color?.hex)
              chrome.storage.local.set({ translatedFontColor: color?.hex })
            }}
            color={translatedFontColor}
            className={'CompactPicker'}
          />
        </List.Item>
        <List.Item className={'flex'}>
          <span className={'label'}>{t('popup.label.translatedWeight')}</span>
          <Slider
            className={'control'}
            min={100}
            max={700}
            step={100}
            onChange={(value: any) => {
              setTranslatedFontWeight(value)
              chrome.storage.local.set({ translatedFontWeight: value })
            }}
            value={translatedFontWeight}
          />
        </List.Item>
        <List.Item>
          <a
            href="https://github.com/ChenYCL/chrome-extension-udemy-translate"
            target="__blank"
            className={'github-link'}
          >
            <GithubFilled style={{ fontSize: '20px', marginRight: '6px' }} />
            {t('popup.issues')}
          </a>
        </List.Item>
      </List>
    </div>
  );
};

export default Popup;