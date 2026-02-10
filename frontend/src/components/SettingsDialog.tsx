import React, { useState, useEffect } from 'react';
import { X, Cpu, ChevronLeft, Plug, Plus, Trash2, Wrench, Check, Loader2, Brain, RefreshCw, Download, RotateCcw, Globe, Layers, Sliders } from 'lucide-react';
import { getConfig, updateConfig, getAvailableTools, ToolInfo } from '../services/configService';
import { getAgentConfigs, updateAgentConfig, AgentConfig } from '../services/strategyService';
import { getMCPServers, MCPServerConfig, MCPServerStatus, testMCPConnection, getMCPServerTools, MCPToolInfo } from '../services/mcpService';
import { checkForUpdate, doUpdate, restartApp, getCurrentVersion, onUpdateProgress, UpdateInfo, UpdateProgress } from '../services/updateService';
import { getStrategies, getActiveStrategyID, setActiveStrategy, deleteStrategy, generateStrategy, updateStrategy, Strategy, StrategyAgent } from '../services/strategyService';

interface AIConfig {
  id: string;
  name: string;
  provider: string;
  baseUrl: string;
  apiKey: string;
  modelName: string;
  maxTokens: number;
  temperature: number;
  timeout: number;
  isDefault: boolean;
  // OpenAI Responses API 开关
  useResponses: boolean;
  // Vertex AI 专用字段
  project: string;
  location: string;
  credentialsJson: string;
}

interface MemoryConfig {
  enabled: boolean;
  aiConfigId: string;
  maxRecentRounds: number;
  maxKeyFacts: number;
  maxSummaryLength: number;
  compressThreshold: number;
}

// 代理模式类型
type ProxyMode = 'none' | 'system' | 'custom';

// 代理配置接口
interface ProxyConfig {
  mode: ProxyMode;
  customUrl: string;
}

type TabType = 'provider' | 'strategy' | 'mcp' | 'memory' | 'proxy' | 'update';

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SettingsDialog: React.FC<SettingsDialogProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<TabType>('provider');
  const [aiConfigs, setAiConfigs] = useState<AIConfig[]>([]);
  const [agentConfigs, setAgentConfigs] = useState<AgentConfig[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<string>('openai');
  const [mcpServers, setMcpServers] = useState<MCPServerConfig[]>([]);
  const [mcpStatus, setMcpStatus] = useState<Record<string, MCPServerStatus>>({});
  const [mcpTools, setMcpTools] = useState<Record<string, MCPToolInfo[]>>({});
  const [selectedMCP, setSelectedMCP] = useState<MCPServerConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [memoryConfig, setMemoryConfig] = useState<MemoryConfig>({
    enabled: true,
    aiConfigId: '',
    maxRecentRounds: 3,
    maxKeyFacts: 20,
    maxSummaryLength: 300,
    compressThreshold: 5,
  });
  const [proxyConfig, setProxyConfig] = useState<ProxyConfig>({
    mode: 'none',
    customUrl: '',
  });
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [activeStrategyId, setActiveStrategyId] = useState<string>('');

  // 原始配置（用于变更检测）
  const [originalConfigs, setOriginalConfigs] = useState<{
    aiConfigs: AIConfig[];
    agentConfigs: AgentConfig[];
    mcpServers: MCPServerConfig[];
  } | null>(null);
  // 完整的原始 AppConfig（用于保存时保留其他字段）
  const [fullConfig, setFullConfig] = useState<{
    theme: string;
  } | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadAllConfigs();
    }
  }, [isOpen]);

  const loadAllConfigs = async () => {
    const config = await getConfig();
    const loadedAiConfigs = config.aiConfigs || [];
    setAiConfigs(loadedAiConfigs);
    const agents = await getAgentConfigs();
    const loadedAgents = agents || [];
    setAgentConfigs(loadedAgents);
    const mcps = await getMCPServers();
    const loadedMcps = mcps || [];
    setMcpServers(loadedMcps);
    // 加载记忆配置
    if (config.memory) {
      setMemoryConfig(config.memory);
    }
    // 加载代理配置
    if (config.proxy) {
      setProxyConfig({
        mode: config.proxy.mode as ProxyMode,
        customUrl: config.proxy.customUrl || '',
      });
    }
    // 保存完整配置的其他字段
    setFullConfig({
      theme: config.theme || 'military',
    });
    // 保存原始配置用于变更检测
    setOriginalConfigs({
      aiConfigs: JSON.parse(JSON.stringify(loadedAiConfigs)),
      agentConfigs: JSON.parse(JSON.stringify(loadedAgents)),
      mcpServers: JSON.parse(JSON.stringify(loadedMcps)),
    });

    // 加载策略配置
    const loadedStrategies = await getStrategies();
    setStrategies(loadedStrategies || []);
    const activeId = await getActiveStrategyID();
    setActiveStrategyId(activeId);

    // 自动检测所有已启用的 MCP 服务器状态并获取工具列表
    const enabledMcps = loadedMcps.filter(m => m.enabled);
    for (const mcp of enabledMcps) {
      testMCPConnection(mcp.id).then(status => {
        setMcpStatus(prev => ({ ...prev, [mcp.id]: status }));
        // 连接成功后获取工具列表
        if (status.connected) {
          getMCPServerTools(mcp.id).then(tools => {
            setMcpTools(prev => ({ ...prev, [mcp.id]: tools || [] }));
          });
        }
      });
    }
  };

  if (!isOpen) return null;

  // 检测配置是否有变更
  const hasChanges = (): boolean => {
    if (!originalConfigs) return false;
    return (
      JSON.stringify(aiConfigs) !== JSON.stringify(originalConfigs.aiConfigs) ||
      JSON.stringify(agentConfigs) !== JSON.stringify(originalConfigs.agentConfigs) ||
      JSON.stringify(mcpServers) !== JSON.stringify(originalConfigs.mcpServers)
    );
  };

  // 处理关闭
  const handleClose = () => {
    if (hasChanges()) {
      setShowCloseConfirm(true);
    } else {
      onClose();
    }
  };

  // 不保存直接关闭
  const handleDiscardAndClose = () => {
    setShowCloseConfirm(false);
    onClose();
  };

  // 保存后关闭
  const handleSaveAndClose = async () => {
    setShowCloseConfirm(false);
    await handleSave(aiConfigs, agentConfigs, mcpServers, memoryConfig, proxyConfig, fullConfig, setSaving, onClose);
  };

  const tabs: { id: TabType; label: string; icon: React.ReactNode }[] = [
    { id: 'provider', label: '模型基座', icon: <Cpu className="h-4 w-4" /> },
    { id: 'strategy', label: '策略管理', icon: <Layers className="h-4 w-4" /> },
    { id: 'mcp', label: 'MCP服务', icon: <Plug className="h-4 w-4" /> },
    { id: 'memory', label: '记忆管理', icon: <Brain className="h-4 w-4" /> },
    { id: 'proxy', label: '网络代理', icon: <Globe className="h-4 w-4" /> },
    { id: 'update', label: '软件更新', icon: <RefreshCw className="h-4 w-4" /> },
  ];

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 backdrop-blur-sm">
      <div className="fin-panel border fin-divider rounded-xl w-[720px] max-h-[85vh] overflow-hidden shadow-2xl">
        <Header onClose={handleClose} />
        <div className="flex h-[500px]">
          {/* 左侧选项卡 */}
          <div className="w-44 fin-panel-strong border-r fin-divider p-2">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm mb-1 transition-all ${
                  activeTab === tab.id
                    ? 'bg-gradient-to-br from-[var(--accent)] to-[var(--accent-2)] text-white'
                    : 'text-slate-400 hover:bg-slate-800/60 hover:text-white'
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>
          {/* 右侧内容 */}
          <div className="flex-1 overflow-y-auto p-4">
            {activeTab === 'provider' && (
              <ProviderSettings
                configs={aiConfigs}
                selectedProvider={selectedProvider}
                onSelectProvider={setSelectedProvider}
                onChange={setAiConfigs}
              />
            )}
            {activeTab === 'strategy' && (
              <StrategySettings
                strategies={strategies}
                activeStrategyId={activeStrategyId}
                onStrategiesChange={setStrategies}
                onActiveChange={setActiveStrategyId}
                onAgentsReload={async () => {
                  const agents = await getAgentConfigs();
                  setAgentConfigs(agents || []);
                }}
                mcpServers={mcpServers}
              />
            )}
            {activeTab === 'mcp' && (
              <MCPSettings
                servers={mcpServers}
                mcpStatus={mcpStatus}
                mcpTools={mcpTools}
                selectedMCP={selectedMCP}
                onSelectMCP={setSelectedMCP}
                onServersChange={setMcpServers}
                onTestConnection={async (id) => {
                  const status = await testMCPConnection(id);
                  setMcpStatus(prev => ({ ...prev, [id]: status }));
                  if (status.connected) {
                    const tools = await getMCPServerTools(id);
                    setMcpTools(prev => ({ ...prev, [id]: tools || [] }));
                  }
                  return status;
                }}
              />
            )}
            {activeTab === 'memory' && (
              <MemorySettings
                config={memoryConfig}
                aiConfigs={aiConfigs}
                onChange={setMemoryConfig}
              />
            )}
            {activeTab === 'proxy' && (
              <ProxySettings
                config={proxyConfig}
                onChange={setProxyConfig}
              />
            )}
            {activeTab === 'update' && (
              <UpdateSettings />
            )}
          </div>
        </div>
        <Footer
          saving={saving}
          onSave={() => handleSave(aiConfigs, agentConfigs, mcpServers, memoryConfig, proxyConfig, fullConfig, setSaving, onClose)}
          onClose={handleClose}
        />
      </div>

      {/* 关闭确认对话框 */}
      {showCloseConfirm && (
        <CloseConfirmDialog
          onSave={handleSaveAndClose}
          onDiscard={handleDiscardAndClose}
          onCancel={() => setShowCloseConfirm(false)}
        />
      )}
    </div>
  );
};

const Header: React.FC<{ onClose: () => void }> = ({ onClose }) => (
  <div className="flex items-center justify-between px-5 py-4 border-b fin-divider fin-panel-strong">
    <h2 className="text-lg font-semibold text-white">设置</h2>
    <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors p-1 rounded hover:bg-slate-800/60">
      <X className="h-5 w-5" />
    </button>
  </div>
);

// ========== 关闭确认对话框 ==========
interface CloseConfirmDialogProps {
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}

const CloseConfirmDialog: React.FC<CloseConfirmDialogProps> = ({ onSave, onDiscard, onCancel }) => (
  <div className="absolute inset-0 bg-black/40 flex items-center justify-center z-10 rounded-xl">
    <div className="fin-panel border fin-divider rounded-lg p-5 w-80 shadow-xl">
      <h3 className="text-white font-medium mb-2">保存更改？</h3>
      <p className="text-slate-400 text-sm mb-4">您有未保存的更改，是否保存后关闭？</p>
      <div className="flex gap-2 justify-end">
        <button
          onClick={onDiscard}
          className="px-3 py-1.5 text-slate-400 hover:text-white text-sm transition-colors"
        >
          不保存
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-1.5 text-slate-400 hover:text-white text-sm transition-colors"
        >
          取消
        </button>
        <button
          onClick={onSave}
          className="px-4 py-1.5 bg-gradient-to-br from-[var(--accent)] to-[var(--accent-2)] text-white rounded-lg text-sm"
        >
          保存
        </button>
      </div>
    </div>
  </div>
);

// ========== Provider 设置选项卡 ==========
const PROVIDERS = ['openai', 'gemini', 'vertexai'] as const;

interface ProviderSettingsProps {
  configs: AIConfig[];
  selectedProvider: string;
  onSelectProvider: (p: string) => void;
  onChange: (configs: AIConfig[]) => void;
}

const ProviderSettings: React.FC<ProviderSettingsProps> = ({ configs, selectedProvider, onSelectProvider, onChange }) => {
  // 获取当前 provider 的配置，如果没有则自动创建
  const getOrCreateConfig = (): AIConfig => {
    const existing = configs.find(c => c.provider === selectedProvider);
    if (existing) return existing;

    // 自动创建新配置
    const newConfig: AIConfig = {
      id: `${selectedProvider}-${Date.now()}`,
      name: `${selectedProvider.charAt(0).toUpperCase() + selectedProvider.slice(1)}`,
      provider: selectedProvider,
      baseUrl: getDefaultBaseUrl(selectedProvider),
      apiKey: '',
      modelName: getDefaultModel(selectedProvider),
      maxTokens: 2048,
      temperature: 0.7,
      timeout: 60,
      isDefault: configs.length === 0,
      useResponses: false,
      project: '',
      location: 'us-central1',
      credentialsJson: '',
    };
    // 添加到配置列表
    onChange([...configs, newConfig]);
    return newConfig;
  };

  const currentConfig = configs.find(c => c.provider === selectedProvider) || getOrCreateConfig();

  const handleUpdate = (updated: AIConfig) => {
    // 如果设置为默认，取消其他配置的默认状态
    if (updated.isDefault) {
      onChange(configs.map(c => c.id === updated.id ? updated : { ...c, isDefault: false }));
    } else {
      onChange(configs.map(c => c.id === updated.id ? updated : c));
    }
  };

  return (
    <div className="space-y-4">
      {/* Provider 切换标签 */}
      <div className="flex gap-1 p-1 fin-panel rounded-lg border fin-divider">
        {PROVIDERS.map(p => (
          <button
            key={p}
            onClick={() => onSelectProvider(p)}
            className={`flex-1 px-3 py-2 text-sm rounded-md transition-all ${
              selectedProvider === p
                ? 'bg-gradient-to-br from-[var(--accent)] to-[var(--accent-2)] text-white'
                : 'text-slate-400 hover:text-white hover:bg-slate-700/60'
            }`}
          >
            {p.charAt(0).toUpperCase() + p.slice(1)}
          </button>
        ))}
      </div>

      {/* 配置表单 - 直接显示 */}
      <ProviderConfigForm config={currentConfig} onChange={handleUpdate} />
    </div>
  );
};

// ========== Provider 配置表单 ==========
interface ProviderConfigFormProps {
  config: AIConfig;
  onChange: (config: AIConfig) => void;
}

const ProviderConfigForm: React.FC<ProviderConfigFormProps> = ({ config, onChange }) => {
  const isVertexAI = config.provider === 'vertexai';

  return (
    <div className="space-y-4 fin-panel rounded-lg p-4 border fin-divider">
      {/* OpenAI/Gemini 通用字段 */}
      {!isVertexAI && (
        <>
          <FormField label="Base URL" value={config.baseUrl} onChange={v => onChange({ ...config, baseUrl: v })} />
          <FormField label="API Key" value={config.apiKey} onChange={v => onChange({ ...config, apiKey: v })} type="password" />
        </>
      )}

      {/* OpenAI Responses API 开关 */}
      {config.provider === 'openai' && (
        <div className="flex items-center justify-between">
          <label className="text-sm text-slate-400">使用 Responses API</label>
          <button
            type="button"
            onClick={() => onChange({ ...config, useResponses: !config.useResponses })}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
              config.useResponses ? 'bg-[var(--accent)]' : 'bg-slate-600'
            }`}
          >
            <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
              config.useResponses ? 'translate-x-[18px]' : 'translate-x-[3px]'
            }`} />
          </button>
        </div>
      )}

      {/* Vertex AI 专用字段 */}
      {isVertexAI && (
        <>
          <FormField label="GCP 项目 ID" value={config.project || ''} onChange={v => onChange({ ...config, project: v })} />
          <FormField label="区域" value={config.location || ''} onChange={v => onChange({ ...config, location: v })} />
          <div>
            <label className="block text-sm text-slate-400 mb-1.5">服务账号证书 (JSON)</label>
            <textarea
              value={config.credentialsJson || ''}
              onChange={e => onChange({ ...config, credentialsJson: e.target.value })}
              rows={6}
              placeholder="粘贴服务账号 JSON 证书内容，留空则使用 ADC 默认凭据"
              className="w-full fin-input rounded-lg px-3 py-2 text-white text-sm resize-none font-mono"
            />
          </div>
        </>
      )}

      {/* 通用字段 */}
      <FormField label="模型名称" value={config.modelName} onChange={v => onChange({ ...config, modelName: v })} />
      <div className="flex items-center pt-2">
        <label className="flex items-center gap-2 text-sm text-slate-400 cursor-pointer">
          <input
            type="radio"
            name="defaultProvider"
            checked={config.isDefault}
            onChange={() => onChange({ ...config, isDefault: true })}
            className="w-4 h-4 bg-slate-700 border-slate-600 text-[var(--accent)]"
          />
          设为默认
        </label>
      </div>
    </div>
  );
};

// ========== 表单组件 ==========
interface FormFieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}

const FormField: React.FC<FormFieldProps> = ({ label, value, onChange, type = 'text' }) => (
  <div>
    <label className="block text-sm text-slate-400 mb-1.5">{label}</label>
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      className="w-full fin-input rounded-lg px-3 py-2 text-white text-sm transition-colors"
    />
  </div>
);

interface FooterProps {
  saving: boolean;
  onSave: () => void;
  onClose: () => void;
}

const Footer: React.FC<FooterProps> = ({ saving, onSave, onClose }) => (
  <div className="flex justify-end gap-3 px-5 py-4 border-t fin-divider fin-panel-strong">
    <button onClick={onClose} className="px-4 py-2 text-slate-400 hover:text-white text-sm transition-colors">
      取消
    </button>
    <button
      onClick={onSave}
      disabled={saving}
      className="px-5 py-2 bg-gradient-to-br from-[var(--accent)] to-[var(--accent-2)] text-white rounded-lg  text-sm disabled:opacity-50 transition-colors"
    >
      {saving ? '保存中...' : '保存'}
    </button>
  </div>
);

// ========== Helper functions ==========
const getDefaultBaseUrl = (provider: string): string => {
  switch (provider) {
    case 'openai': return 'https://api.openai.com/v1';
    case 'gemini': return 'https://generativelanguage.googleapis.com';
    default: return '';
  }
};

const getDefaultModel = (provider: string): string => {
  switch (provider) {
    case 'openai': return 'gpt-4';
    case 'gemini': return 'gemini-pro';
    case 'vertexai': return 'gemini-1.5-pro';
    default: return '';
  }
};

const handleSave = async (
  configs: AIConfig[],
  agents: AgentConfig[],
  mcpServers: MCPServerConfig[],
  memoryConfig: MemoryConfig,
  proxyConfig: ProxyConfig,
  fullConfig: { theme: string } | null,
  setSaving: React.Dispatch<React.SetStateAction<boolean>>,
  onClose: () => void
) => {
  setSaving(true);
  try {
    // 保存完整的 AI 配置、MCP 配置、记忆配置和代理配置
    await updateConfig({
      theme: fullConfig?.theme || 'military',
      aiConfigs: configs,
      defaultAiId: configs.find(c => c.isDefault)?.id || '',
      mcpServers: mcpServers,
      memory: memoryConfig,
      proxy: proxyConfig,
    } as any);

    // 保存所有 Agent 配置（会触发后端重载）
    for (const agent of agents) {
      await updateAgentConfig(agent);
    }

    onClose();
  } finally {
    setSaving(false);
  }
};

// ========== 记忆管理设置选项卡 ==========
interface MemorySettingsProps {
  config: MemoryConfig;
  aiConfigs: AIConfig[];
  onChange: (config: MemoryConfig) => void;
}

const MemorySettings: React.FC<MemorySettingsProps> = ({ config, aiConfigs, onChange }) => {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-white font-medium">记忆管理</h3>
          <p className="text-slate-400 text-sm mt-1">
            启用后，AI专家将记住之前的讨论内容，提供更连贯的分析
          </p>
        </div>
        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(e) => onChange({ ...config, enabled: e.target.checked })}
            className="sr-only peer"
          />
          <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-accent"></div>
        </label>
      </div>

      {config.enabled && (
        <div className="space-y-4 pt-4 border-t border-slate-700">
          {/* LLM 选择 */}
          <div>
            <label className="block text-sm text-slate-300 mb-2">
              摘要模型
              <span className="text-slate-500 ml-2">(用于生成记忆摘要)</span>
            </label>
            <select
              value={config.aiConfigId || ''}
              onChange={(e) => onChange({ ...config, aiConfigId: e.target.value })}
              className="w-full fin-input rounded-lg px-3 py-2 text-white text-sm"
            >
              <option value="">使用默认模型</option>
              {aiConfigs.map(ai => (
                <option key={ai.id} value={ai.id}>
                  {ai.name} ({ai.provider}) - {ai.modelName}
                </option>
              ))}
            </select>
            <p className="text-xs text-slate-500 mt-1">
              建议选择较快的模型以减少延迟，留空则使用会议默认模型
            </p>
          </div>

          <div>
            <label className="block text-sm text-slate-300 mb-2">
              保留最近讨论轮次
              <span className="text-slate-500 ml-2">({config.maxRecentRounds}轮)</span>
            </label>
            <input
              type="range"
              min="1"
              max="10"
              value={config.maxRecentRounds}
              onChange={(e) => onChange({ ...config, maxRecentRounds: parseInt(e.target.value) })}
              className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-[var(--accent)]"
            />
            <div className="flex justify-between text-xs text-slate-500 mt-1">
              <span>1轮</span>
              <span>10轮</span>
            </div>
          </div>

          <div>
            <label className="block text-sm text-slate-300 mb-2">
              触发压缩阈值
              <span className="text-slate-500 ml-2">({config.compressThreshold}轮)</span>
            </label>
            <input
              type="range"
              min="3"
              max="15"
              value={config.compressThreshold}
              onChange={(e) => onChange({ ...config, compressThreshold: parseInt(e.target.value) })}
              className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-[var(--accent)]"
            />
            <p className="text-xs text-slate-500 mt-1">
              超过此轮次后，旧讨论将被压缩为摘要
            </p>
          </div>

          <div>
            <label className="block text-sm text-slate-300 mb-2">
              最大关键事实数
              <span className="text-slate-500 ml-2">({config.maxKeyFacts}条)</span>
            </label>
            <input
              type="range"
              min="5"
              max="50"
              step="5"
              value={config.maxKeyFacts}
              onChange={(e) => onChange({ ...config, maxKeyFacts: parseInt(e.target.value) })}
              className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-[var(--accent)]"
            />
          </div>

          <div>
            <label className="block text-sm text-slate-300 mb-2">
              摘要最大长度
              <span className="text-slate-500 ml-2">({config.maxSummaryLength}字)</span>
            </label>
            <input
              type="range"
              min="100"
              max="500"
              step="50"
              value={config.maxSummaryLength}
              onChange={(e) => onChange({ ...config, maxSummaryLength: parseInt(e.target.value) })}
              className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-[var(--accent)]"
            />
          </div>
        </div>
      )}
    </div>
  );
};

// ========== MCP 设置选项卡 ==========
interface MCPSettingsProps {
  servers: MCPServerConfig[];
  mcpStatus: Record<string, MCPServerStatus>;
  mcpTools: Record<string, MCPToolInfo[]>;
  selectedMCP: MCPServerConfig | null;
  onSelectMCP: (mcp: MCPServerConfig | null) => void;
  onServersChange: (servers: MCPServerConfig[]) => void;
  onTestConnection: (id: string) => Promise<MCPServerStatus>;
}

const MCPSettings: React.FC<MCPSettingsProps> = ({
  servers, mcpStatus, mcpTools, selectedMCP, onSelectMCP, onServersChange, onTestConnection
}) => {
  if (selectedMCP) {
    return (
      <MCPEditForm
        server={selectedMCP}
        status={mcpStatus[selectedMCP.id]}
        tools={mcpTools[selectedMCP.id] || []}
        onBack={() => onSelectMCP(null)}
        onChange={(updated) => {
          onServersChange(servers.map(s => s.id === updated.id ? updated : s));
          onSelectMCP(updated);
        }}
        onDelete={() => {
          onServersChange(servers.filter(s => s.id !== selectedMCP.id));
          onSelectMCP(null);
        }}
        onTestConnection={() => onTestConnection(selectedMCP.id)}
      />
    );
  }

  const handleAddNew = () => {
    const newServer: MCPServerConfig = {
      id: `mcp-${Date.now()}`,
      name: '新 MCP 服务',
      transportType: 'http',
      endpoint: '',
      command: '',
      args: [],
      toolFilter: [],
      enabled: true,
    };
    onServersChange([...servers, newServer]);
    onSelectMCP(newServer);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-white">MCP 服务器</h3>
        <button
          onClick={handleAddNew}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-gradient-to-br from-[var(--accent)] to-[var(--accent-2)] text-white rounded-lg "
        >
          <Plus className="h-3.5 w-3.5" />
          添加
        </button>
      </div>
      <p className="text-xs text-slate-500 mb-4">配置 MCP 服务器以扩展 Agent 能力</p>
      {servers.length === 0 ? (
        <p className="text-slate-500 text-sm text-center py-8">暂无 MCP 服务器配置</p>
      ) : (
        servers.map(server => (
          <MCPListItem
            key={server.id}
            server={server}
            status={mcpStatus[server.id]}
            toolCount={(mcpTools[server.id] || []).length}
            onClick={() => onSelectMCP(server)}
          />
        ))
      )}
    </div>
  );
};

const MCPListItem: React.FC<{
  server: MCPServerConfig;
  status?: MCPServerStatus;
  toolCount: number;
  onClick: () => void;
}> = ({ server, status, toolCount, onClick }) => {
  // 状态指示器颜色
  const getStatusColor = () => {
    if (!server.enabled) return 'bg-slate-600';
    if (!status) return 'bg-yellow-500 animate-pulse'; // 检测中
    return status.connected ? 'bg-accent' : 'bg-red-500';
  };

  const getStatusText = () => {
    if (!server.enabled) return '已禁用';
    if (!status) return '检测中...';
    return status.connected ? '已连接' : status.error || '连接失败';
  };

  return (
    <div
      onClick={onClick}
      className="flex items-center gap-3 p-3 fin-panel-soft rounded-lg hover:bg-slate-800/60 transition-colors border fin-divider cursor-pointer"
    >
      <div className="w-10 h-10 rounded-full flex items-center justify-center text-lg shrink-0 bg-purple-500/20 text-purple-400">
        <Plug className="h-5 w-5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-white text-sm font-medium">{server.name}</span>
          <span className="text-xs px-1.5 py-0.5 fin-chip text-slate-400 rounded">{server.transportType}</span>
        </div>
        <p className="text-slate-500 text-xs truncate">
          {server.transportType === 'command' ? server.command : server.endpoint}
        </p>
      </div>
      <div className="flex items-center gap-3">
        {/* 工具数量 */}
        {status?.connected && toolCount > 0 && (
          <span className="text-xs text-slate-400 flex items-center gap-1">
            <Wrench className="h-3 w-3" />
            {toolCount}
          </span>
        )}
        <div className={`w-2 h-2 rounded-full ${getStatusColor()}`} title={getStatusText()} />
      </div>
    </div>
  );
};

// ========== MCP 编辑表单 ==========
interface MCPEditFormProps {
  server: MCPServerConfig;
  status?: MCPServerStatus;
  tools: MCPToolInfo[];
  onBack: () => void;
  onChange: (server: MCPServerConfig) => void;
  onDelete: () => void;
  onTestConnection: () => Promise<MCPServerStatus>;
}

const MCPEditForm: React.FC<MCPEditFormProps> = ({ server, status, tools, onBack, onChange, onDelete, onTestConnection }) => {
  const [edited, setEdited] = useState<MCPServerConfig>(server);
  const [testing, setTesting] = useState(false);

  const handleChange = <K extends keyof MCPServerConfig>(field: K, value: MCPServerConfig[K]) => {
    const updated = { ...edited, [field]: value };
    setEdited(updated);
    onChange(updated);
  };

  return (
    <div className="space-y-4">
      {/* 头部 */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-1.5 rounded-lg hover:bg-slate-700/60 text-slate-400 hover:text-white transition-colors"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full flex items-center justify-center bg-purple-500/20 text-purple-400">
              <Plug className="h-5 w-5" />
            </div>
            <h3 className="text-white font-medium">{edited.name}</h3>
          </div>
        </div>
        <button
          onClick={onDelete}
          className="p-2 rounded-lg hover:bg-red-500/20 text-slate-400 hover:text-red-400 transition-colors"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {/* 名称 */}
      <FormField label="名称" value={edited.name} onChange={v => handleChange('name', v)} />

      {/* 传输类型 */}
      <div>
        <label className="block text-sm text-slate-400 mb-1.5">传输类型</label>
        <select
          value={edited.transportType}
          onChange={e => handleChange('transportType', e.target.value as MCPServerConfig['transportType'])}
          className="w-full fin-input rounded-lg px-3 py-2 text-white text-sm"
        >
          <option value="http">HTTP (推荐)</option>
          <option value="sse">SSE</option>
          <option value="command">命令行</option>
        </select>
      </div>

      {/* 根据传输类型显示不同字段 */}
      {edited.transportType === 'command' ? (
        <>
          <FormField label="命令" value={edited.command} onChange={v => handleChange('command', v)} />
          <FormField
            label="参数 (逗号分隔)"
            value={edited.args.join(', ')}
            onChange={v => handleChange('args', v.split(',').map(s => s.trim()).filter(Boolean))}
          />
        </>
      ) : (
        <FormField label="端点 URL" value={edited.endpoint} onChange={v => handleChange('endpoint', v)} />
      )}

      {/* 启用状态 */}
      <div className="flex items-center justify-between pt-2">
        <span className="text-sm text-slate-400">启用此服务</span>
        <button
          onClick={() => handleChange('enabled', !edited.enabled)}
          className={`w-11 h-6 rounded-full transition-colors ${
            edited.enabled ? 'bg-gradient-to-r from-[var(--accent)] to-[var(--accent-2)]' : 'bg-slate-600'
          }`}
        >
          <div className={`w-5 h-5 bg-white rounded-full shadow transition-transform ${
            edited.enabled ? 'translate-x-5' : 'translate-x-0.5'
          }`} />
        </button>
      </div>

      {/* 连接测试 */}
      <div className="pt-3 border-t fin-divider">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-400">连接状态</span>
            {status && (
              <span className={`text-xs px-2 py-0.5 rounded ${
                status.connected
                  ? 'bg-accent/20 text-accent-2'
                  : 'bg-red-500/20 text-red-400'
              }`}>
                {status.connected ? '已连接' : status.error || '连接失败'}
              </span>
            )}
            {!status && edited.enabled && (
              <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/20 text-yellow-400">
                未测试
              </span>
            )}
          </div>
          <button
            onClick={async () => {
              setTesting(true);
              await onTestConnection();
              setTesting(false);
            }}
            disabled={testing || !edited.enabled}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg disabled:opacity-50 transition-colors"
          >
            {testing ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                测试中...
              </>
            ) : (
              '测试连接'
            )}
          </button>
        </div>
      </div>

      {/* 工具列表 */}
      {status?.connected && tools.length > 0 && (
        <div className="pt-3 border-t fin-divider">
          <div className="flex items-center gap-2 mb-3">
            <Wrench className="h-4 w-4 text-slate-400" />
            <span className="text-sm text-slate-400">可用工具</span>
            <span className="text-xs text-slate-500">({tools.length})</span>
          </div>
          <div className="space-y-2 max-h-40 overflow-y-auto fin-scrollbar">
            {tools.map(tool => (
              <div key={tool.name} className="p-2 rounded-lg bg-slate-800/40 border fin-divider">
                <div className="text-white text-xs font-medium">{tool.name}</div>
                <div className="text-slate-500 text-xs mt-0.5 line-clamp-2">{tool.description}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ========== 代理设置选项卡 ==========
interface ProxySettingsProps {
  config: ProxyConfig;
  onChange: (config: ProxyConfig) => void;
}

const ProxySettings: React.FC<ProxySettingsProps> = ({ config, onChange }) => {
  const proxyModes: { value: ProxyMode; label: string; desc: string }[] = [
    { value: 'none', label: '无代理', desc: '直接连接，不使用任何代理' },
    { value: 'system', label: '系统代理', desc: '使用操作系统的代理设置' },
    { value: 'custom', label: '自定义代理', desc: '手动指定代理服务器地址' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-white font-medium">网络代理</h3>
        <p className="text-slate-400 text-sm mt-1">
          配置应用的网络代理，用于访问 AI 服务和外部 API
        </p>
      </div>

      {/* 代理模式选择 */}
      <div className="space-y-3">
        {proxyModes.map(mode => (
          <label
            key={mode.value}
            className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
              config.mode === mode.value
                ? 'border-[var(--accent)] bg-[var(--accent)]/10'
                : 'border-slate-700 hover:border-slate-600'
            }`}
          >
            <input
              type="radio"
              name="proxyMode"
              value={mode.value}
              checked={config.mode === mode.value}
              onChange={() => onChange({ ...config, mode: mode.value })}
              className="mt-1 accent-[var(--accent)]"
            />
            <div>
              <div className="text-white text-sm font-medium">{mode.label}</div>
              <div className="text-slate-400 text-xs mt-0.5">{mode.desc}</div>
            </div>
          </label>
        ))}
      </div>

      {/* 自定义代理地址输入 */}
      {config.mode === 'custom' && (
        <div className="pt-4 border-t border-slate-700">
          <label className="block text-sm text-slate-300 mb-2">
            代理服务器地址
          </label>
          <input
            type="text"
            value={config.customUrl}
            onChange={(e) => onChange({ ...config, customUrl: e.target.value })}
            placeholder="http://127.0.0.1:7890"
            className="w-full fin-input rounded-lg px-3 py-2 text-white text-sm"
          />
          <p className="text-slate-500 text-xs mt-2">
            支持 HTTP/HTTPS 代理，格式：http://host:port 或 http://user:pass@host:port
          </p>
        </div>
      )}
    </div>
  );
};

// ========== 更新设置选项卡 ==========
const UpdateSettings: React.FC = () => {
  const [currentVersion, setCurrentVersion] = useState<string>('');
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [progress, setProgress] = useState<UpdateProgress | null>(null);

  useEffect(() => {
    getCurrentVersion().then(setCurrentVersion);
    const cleanup = onUpdateProgress(setProgress);
    return cleanup;
  }, []);

  const handleCheckUpdate = async () => {
    setChecking(true);
    setUpdateInfo(null);
    try {
      const info = await checkForUpdate();
      setUpdateInfo(info);
    } finally {
      setChecking(false);
    }
  };

  const handleUpdate = async () => {
    setUpdating(true);
    setProgress(null);
    try {
      const result = await doUpdate();
      if (result !== 'success') {
        setProgress({ status: 'error', message: result, percent: 0 });
      }
    } catch (e) {
      setProgress({ status: 'error', message: String(e), percent: 0 });
    }
  };

  const handleRestart = async () => {
    await restartApp();
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-white font-medium">软件更新</h3>
        <p className="text-slate-400 text-sm mt-1">检查并安装最新版本</p>
      </div>

      <div className="fin-panel rounded-lg p-4 border fin-divider">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-slate-400 text-sm">当前版本</span>
            <p className="text-white font-medium mt-1">v{currentVersion || '...'}</p>
          </div>
          <button
            onClick={handleCheckUpdate}
            disabled={checking || updating}
            className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-sm disabled:opacity-50 transition-colors"
          >
            {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {checking ? '检查中...' : '检查更新'}
          </button>
        </div>
      </div>

      {updateInfo && (
        <div className={`fin-panel rounded-lg p-4 border ${updateInfo.hasUpdate ? 'border-accent/50 bg-accent/5' : 'fin-divider'}`}>
          {updateInfo.error ? (
            <div className="text-red-400 text-sm">{updateInfo.error}</div>
          ) : updateInfo.hasUpdate ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-accent-2 text-sm font-medium">发现新版本</span>
                  <p className="text-white font-medium mt-1">v{updateInfo.latestVersion}</p>
                </div>
                <button onClick={handleUpdate} disabled={updating}
                  className="flex items-center gap-2 px-4 py-2 bg-gradient-to-br from-[var(--accent)] to-[var(--accent-2)] text-white rounded-lg text-sm disabled:opacity-50">
                  {updating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  {updating ? '更新中...' : '立即更新'}
                </button>
              </div>
              {updateInfo.releaseNotes && (
                <div className="pt-3 border-t fin-divider">
                  <span className="text-slate-400 text-xs">更新说明</span>
                  <p className="text-slate-300 text-sm mt-1 whitespace-pre-wrap">{updateInfo.releaseNotes}</p>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-accent-2">
              <Check className="h-4 w-4" /><span className="text-sm">已是最新版本</span>
            </div>
          )}
        </div>
      )}

      {progress && (
        <div className="fin-panel rounded-lg p-4 border fin-divider">
          <div className="flex items-center justify-between mb-2">
            <span className="text-slate-400 text-sm">{progress.message}</span>
            {progress.status === 'completed' && (
              <button onClick={handleRestart} className="flex items-center gap-2 px-3 py-1.5 bg-accent text-white rounded-lg text-xs">
                <RotateCcw className="h-3 w-3" />重启应用
              </button>
            )}
          </div>
          {progress.percent > 0 && (
            <div className="w-full bg-slate-700 rounded-full h-2">
              <div className={`h-2 rounded-full transition-all ${progress.status === 'error' ? 'bg-red-500' : progress.status === 'completed' ? 'bg-accent' : 'bg-accent-2'}`}
                style={{ width: `${progress.percent}%` }} />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ========== 策略配置选项卡 ==========
interface StrategySettingsProps {
  strategies: Strategy[];
  activeStrategyId: string;
  onStrategiesChange: (strategies: Strategy[]) => void;
  onActiveChange: (id: string) => void;
  onAgentsReload: () => void;
  mcpServers: MCPServerConfig[];
}

// 视图类型
type StrategyView = 'list' | 'agents' | 'agent-edit';

const StrategySettings: React.FC<StrategySettingsProps> = ({
  strategies, activeStrategyId, onStrategiesChange, onActiveChange, onAgentsReload, mcpServers
}) => {
  const [view, setView] = useState<StrategyView>('list');
  const [selectedStrategy, setSelectedStrategy] = useState<Strategy | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<StrategyAgent | null>(null);
  const [availableTools, setAvailableTools] = useState<ToolInfo[]>([]);
  const [generating, setGenerating] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [error, setError] = useState('');

  // 加载可用工具
  useEffect(() => {
    getAvailableTools().then(setAvailableTools);
  }, []);

  // 进入策略的专家列表
  const handleSelectStrategy = (strategy: Strategy) => {
    setSelectedStrategy(strategy);
    setView('agents');
  };

  // 进入专家编辑
  const handleSelectAgent = (agent: StrategyAgent) => {
    setSelectedAgent(agent);
    setView('agent-edit');
  };

  // 返回策略列表
  const handleBackToList = () => {
    setSelectedStrategy(null);
    setSelectedAgent(null);
    setView('list');
  };

  // 返回专家列表
  const handleBackToAgents = () => {
    setSelectedAgent(null);
    setView('agents');
  };

  // 更新策略中的专家
  const handleUpdateAgent = async (updatedAgent: StrategyAgent) => {
    if (!selectedStrategy) return;
    const updatedAgents = selectedStrategy.agents.map(a =>
      a.id === updatedAgent.id ? updatedAgent : a
    );
    const updatedStrategy = { ...selectedStrategy, agents: updatedAgents };
    setSelectedStrategy(updatedStrategy);
    setSelectedAgent(updatedAgent);

    // 更新策略列表
    const newStrategies = strategies.map(s =>
      s.id === updatedStrategy.id ? updatedStrategy : s
    );
    onStrategiesChange(newStrategies);

    // 保存到后端
    await updateStrategy(updatedStrategy);

    // 如果是当前激活策略，重新加载 agents
    if (selectedStrategy.id === activeStrategyId) {
      onAgentsReload();
    }
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setGenerating(true);
    setError('');
    try {
      const result = await generateStrategy(prompt);
      if (result.success && result.strategy) {
        onStrategiesChange([...strategies, result.strategy]);
        setPrompt('');
      } else {
        setError(result.error || '生成失败');
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setGenerating(false);
    }
  };

  const handleDelete = async (id: string) => {
    const result = await deleteStrategy(id);
    if (result === 'success') {
      onStrategiesChange(strategies.filter(s => s.id !== id));
    }
  };

  const handleActivate = async (id: string) => {
    const result = await setActiveStrategy(id);
    if (result === 'success') {
      onActiveChange(id);
      onAgentsReload();
    }
  };

  // 专家编辑视图
  if (view === 'agent-edit' && selectedStrategy && selectedAgent) {
    return (
      <StrategyAgentEdit
        agent={selectedAgent}
        strategy={selectedStrategy}
        availableTools={availableTools}
        mcpServers={mcpServers}
        onBack={handleBackToAgents}
        onChange={handleUpdateAgent}
      />
    );
  }

  // 专家列表视图
  if (view === 'agents' && selectedStrategy) {
    return (
      <StrategyAgentList
        strategy={selectedStrategy}
        isActive={selectedStrategy.id === activeStrategyId}
        onBack={handleBackToList}
        onSelectAgent={handleSelectAgent}
        onAgentToggle={handleUpdateAgent}
      />
    );
  }

  // 策略列表视图
  return (
    <StrategyListView
      strategies={strategies}
      activeStrategyId={activeStrategyId}
      generating={generating}
      prompt={prompt}
      error={error}
      onPromptChange={setPrompt}
      onGenerate={handleGenerate}
      onSelectStrategy={handleSelectStrategy}
      onActivate={handleActivate}
      onDelete={handleDelete}
    />
  );
};

// 策略列表项组件
interface StrategyListItemProps {
  strategy: Strategy;
  isActive: boolean;
  onSelect: () => void;
  onActivate: () => void;
  onDelete: () => void;
}

const StrategyListItem: React.FC<StrategyListItemProps> = ({
  strategy, isActive, onSelect, onActivate, onDelete
}) => {
  const agentNames = strategy.agents?.map(a => a.name).join('、') || '无';
  const enabledCount = strategy.agents?.filter(a => a.enabled).length || 0;

  return (
    <div
      onClick={onSelect}
      className={`p-3 rounded-lg border transition-all cursor-pointer ${
        isActive ? 'border-accent/50 bg-accent/10' : 'border-slate-700 hover:border-slate-600'
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">{strategy.icon}</span>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-white text-sm font-medium">{strategy.name}</span>
              {strategy.isBuiltin && (
                <span className="text-xs px-1.5 py-0.5 fin-chip text-slate-400 rounded">内置</span>
              )}
              {strategy.source === 'ai' && (
                <span className="text-xs px-1.5 py-0.5 bg-purple-500/20 text-purple-400 rounded">AI</span>
              )}
              {isActive && (
                <span className="text-xs px-1.5 py-0.5 bg-accent/20 text-accent-2 rounded">当前</span>
              )}
            </div>
            <p className="text-slate-500 text-xs">{strategy.description}</p>
            <p className="text-slate-600 text-xs mt-1">
              专家: {agentNames} ({enabledCount}/{strategy.agents?.length || 0}启用)
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
          {!isActive && (
            <button
              onClick={onActivate}
              className="px-2 py-1 text-xs text-accent-2 hover:bg-accent/20 rounded"
            >
              启用
            </button>
          )}
          {!strategy.isBuiltin && !isActive && (
            <button
              onClick={onDelete}
              className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-red-500/20 rounded"
              title="删除策略"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// ========== 策略列表视图 ==========
interface StrategyListViewProps {
  strategies: Strategy[];
  activeStrategyId: string;
  generating: boolean;
  prompt: string;
  error: string;
  onPromptChange: (v: string) => void;
  onGenerate: () => void;
  onSelectStrategy: (s: Strategy) => void;
  onActivate: (id: string) => void;
  onDelete: (id: string) => void;
}

const StrategyListView: React.FC<StrategyListViewProps> = ({
  strategies, activeStrategyId, generating, prompt, error,
  onPromptChange, onGenerate, onSelectStrategy, onActivate, onDelete
}) => (
  <div className="space-y-6">
    {/* AI生成策略 */}
    <div>
      <h3 className="text-white font-medium mb-3">✨ AI生成策略</h3>
      <textarea
        value={prompt}
        onChange={(e) => onPromptChange(e.target.value)}
        placeholder="描述你想要的投资策略..."
        rows={3}
        className="w-full fin-input rounded-lg px-3 py-2 text-white text-sm resize-none"
      />
      {error && <p className="text-red-400 text-xs mt-1">{error}</p>}
      <button
        onClick={onGenerate}
        disabled={generating || !prompt.trim()}
        className="mt-2 px-4 py-2 bg-gradient-to-br from-[var(--accent)] to-[var(--accent-2)] text-white rounded-lg text-sm disabled:opacity-50 flex items-center gap-2"
      >
        {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
        {generating ? '生成中...' : '生成策略'}
      </button>
    </div>

    {/* 策略列表 */}
    <div>
      <h3 className="text-white font-medium mb-3">📁 策略列表</h3>
      <p className="text-slate-500 text-xs mb-3">点击策略可查看和编辑专家配置</p>
      <div className="space-y-2">
        {strategies.map(s => (
          <StrategyListItem
            key={s.id}
            strategy={s}
            isActive={s.id === activeStrategyId}
            onSelect={() => onSelectStrategy(s)}
            onActivate={() => onActivate(s.id)}
            onDelete={() => onDelete(s.id)}
          />
        ))}
      </div>
    </div>
  </div>
);

// ========== 策略专家列表视图 ==========
interface StrategyAgentListProps {
  strategy: Strategy;
  isActive: boolean;
  onBack: () => void;
  onSelectAgent: (agent: StrategyAgent) => void;
  onAgentToggle: (agent: StrategyAgent) => void;
}

const StrategyAgentList: React.FC<StrategyAgentListProps> = ({
  strategy, isActive, onBack, onSelectAgent, onAgentToggle
}) => {
  const enabledCount = strategy.agents?.filter(a => a.enabled).length || 0;

  return (
    <div className="space-y-4">
      {/* 头部 */}
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="p-1.5 rounded-lg hover:bg-slate-700/60 text-slate-400 hover:text-white transition-colors"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <span className="text-2xl">{strategy.icon}</span>
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-white font-medium">{strategy.name}</h3>
            {isActive && (
              <span className="text-xs px-1.5 py-0.5 bg-accent/20 text-accent-2 rounded">当前策略</span>
            )}
          </div>
          <p className="text-slate-500 text-xs">{strategy.description}</p>
        </div>
      </div>

      {/* 专家统计 */}
      <div className="text-sm text-slate-400">
        共 {strategy.agents?.length || 0} 位专家，{enabledCount} 位已启用
      </div>

      {/* 专家列表 */}
      <div className="space-y-2">
        {strategy.agents?.map(agent => (
          <StrategyAgentListItem
            key={agent.id}
            agent={agent}
            onSelect={() => onSelectAgent(agent)}
            onToggle={() => onAgentToggle({ ...agent, enabled: !agent.enabled })}
          />
        ))}
      </div>
    </div>
  );
};

// 策略专家列表项
interface StrategyAgentListItemProps {
  agent: StrategyAgent;
  onSelect: () => void;
  onToggle: () => void;
}

const StrategyAgentListItem: React.FC<StrategyAgentListItemProps> = ({
  agent, onSelect, onToggle
}) => (
  <div
    onClick={onSelect}
    className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
      agent.enabled
        ? 'border-slate-700 hover:border-slate-600'
        : 'border-slate-800 bg-slate-800/30 opacity-60'
    }`}
  >
    <div
      className="w-10 h-10 rounded-full flex items-center justify-center text-lg shrink-0"
      style={{ backgroundColor: agent.color + '20', color: agent.color }}
    >
      {agent.avatar || agent.name.charAt(0)}
    </div>
    <div className="flex-1 min-w-0">
      <div className="text-white text-sm font-medium">{agent.name}</div>
      <div className="text-slate-500 text-xs">{agent.role}</div>
    </div>
    <button
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
      className={`w-10 h-5 rounded-full transition-colors ${
        agent.enabled ? 'bg-accent' : 'bg-slate-600'
      }`}
    >
      <div className={`w-4 h-4 bg-white rounded-full shadow transition-transform ${
        agent.enabled ? 'translate-x-5' : 'translate-x-0.5'
      }`} />
    </button>
  </div>
);

// ========== 策略专家编辑视图 ==========
interface StrategyAgentEditProps {
  agent: StrategyAgent;
  strategy: Strategy;
  availableTools: ToolInfo[];
  mcpServers: MCPServerConfig[];
  onBack: () => void;
  onChange: (agent: StrategyAgent) => void;
}

type AgentEditTab = 'basic' | 'tools';

const StrategyAgentEdit: React.FC<StrategyAgentEditProps> = ({
  agent, strategy, availableTools, mcpServers, onBack, onChange
}) => {
  const [editedAgent, setEditedAgent] = useState<StrategyAgent>(agent);
  const [activeTab, setActiveTab] = useState<AgentEditTab>('basic');

  useEffect(() => {
    setEditedAgent(agent);
  }, [agent]);

  const handleChange = <K extends keyof StrategyAgent>(field: K, value: StrategyAgent[K]) => {
    const updated = { ...editedAgent, [field]: value };
    setEditedAgent(updated);
    onChange(updated);
  };

  const toggleTool = (toolName: string) => {
    const currentTools = editedAgent.tools || [];
    const newTools = currentTools.includes(toolName)
      ? currentTools.filter(t => t !== toolName)
      : [...currentTools, toolName];
    handleChange('tools', newTools);
  };

  const toggleMCPServer = (serverId: string) => {
    const currentServers = editedAgent.mcpServers || [];
    const newServers = currentServers.includes(serverId)
      ? currentServers.filter(s => s !== serverId)
      : [...currentServers, serverId];
    handleChange('mcpServers', newServers);
  };

  const selectedToolsCount = (editedAgent.tools || []).length;
  const selectedMCPCount = (editedAgent.mcpServers || []).length;

  return (
    <div className="space-y-4">
      {/* 头部 */}
      <AgentEditHeader
        agent={editedAgent}
        strategyName={strategy.name}
        onBack={onBack}
        onToggleEnabled={() => handleChange('enabled', !editedAgent.enabled)}
      />

      {/* 标签页切换 */}
      <AgentEditTabs
        activeTab={activeTab}
        selectedToolsCount={selectedToolsCount}
        selectedMCPCount={selectedMCPCount}
        onTabChange={setActiveTab}
      />

      {/* 基础配置 */}
      {activeTab === 'basic' && (
        <AgentBasicConfig
          agent={editedAgent}
          onChange={handleChange}
        />
      )}

      {/* 工具配置 */}
      {activeTab === 'tools' && (
        <AgentToolsConfig
          agent={editedAgent}
          availableTools={availableTools}
          mcpServers={mcpServers}
          onToggleTool={toggleTool}
          onToggleMCPServer={toggleMCPServer}
        />
      )}
    </div>
  );
};

// 专家编辑头部
interface AgentEditHeaderProps {
  agent: StrategyAgent;
  strategyName: string;
  onBack: () => void;
  onToggleEnabled: () => void;
}

const AgentEditHeader: React.FC<AgentEditHeaderProps> = ({
  agent, strategyName, onBack, onToggleEnabled
}) => (
  <div className="flex items-center justify-between">
    <div className="flex items-center gap-3">
      <button
        onClick={onBack}
        className="p-1.5 rounded-lg hover:bg-slate-700/60 text-slate-400 hover:text-white transition-colors"
      >
        <ChevronLeft className="h-5 w-5" />
      </button>
      <div
        className="w-10 h-10 rounded-full flex items-center justify-center text-lg"
        style={{ backgroundColor: agent.color + '20', color: agent.color }}
      >
        {agent.avatar || agent.name.charAt(0)}
      </div>
      <div>
        <h3 className="text-white font-medium">{agent.name}</h3>
        <p className="text-xs text-slate-500">{strategyName} / {agent.role}</p>
      </div>
    </div>
    <button
      onClick={onToggleEnabled}
      className={`w-11 h-6 rounded-full transition-colors ${
        agent.enabled ? 'bg-accent' : 'bg-slate-600'
      }`}
    >
      <div className={`w-5 h-5 bg-white rounded-full shadow transition-transform ${
        agent.enabled ? 'translate-x-5' : 'translate-x-0.5'
      }`} />
    </button>
  </div>
);

// 专家编辑标签页
interface AgentEditTabsProps {
  activeTab: AgentEditTab;
  selectedToolsCount: number;
  selectedMCPCount: number;
  onTabChange: (tab: AgentEditTab) => void;
}

const AgentEditTabs: React.FC<AgentEditTabsProps> = ({
  activeTab, selectedToolsCount, selectedMCPCount, onTabChange
}) => {
  const totalCount = selectedToolsCount + selectedMCPCount;
  return (
    <div className="flex gap-1 p-1 fin-panel rounded-lg border fin-divider">
      <button
        onClick={() => onTabChange('basic')}
        className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm rounded-md transition-all ${
          activeTab === 'basic'
            ? 'bg-gradient-to-br from-[var(--accent)] to-[var(--accent-2)] text-white'
            : 'text-slate-400 hover:text-white hover:bg-slate-700/60'
        }`}
      >
        <Sliders className="h-4 w-4" />
        基础配置
      </button>
      <button
        onClick={() => onTabChange('tools')}
        className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm rounded-md transition-all ${
          activeTab === 'tools'
            ? 'bg-gradient-to-br from-[var(--accent)] to-[var(--accent-2)] text-white'
            : 'text-slate-400 hover:text-white hover:bg-slate-700/60'
        }`}
      >
        <Wrench className="h-4 w-4" />
        工具配置
        {totalCount > 0 && (
          <span className="px-1.5 py-0.5 text-xs bg-white/20 rounded-full">
            {totalCount}
          </span>
        )}
      </button>
    </div>
  );
};

// 专家基础配置
interface AgentBasicConfigProps {
  agent: StrategyAgent;
  onChange: <K extends keyof StrategyAgent>(field: K, value: StrategyAgent[K]) => void;
}

const AgentBasicConfig: React.FC<AgentBasicConfigProps> = ({ agent, onChange }) => (
  <div className="space-y-4">
    <div>
      <label className="block text-sm text-slate-400 mb-1.5">系统指令 (Prompt)</label>
      <textarea
        value={agent.instruction || ""}
        onChange={e => onChange("instruction", e.target.value)}
        rows={10}
        placeholder="定义专家的行为和角色..."
        className="w-full fin-input rounded-lg px-3 py-2 text-white text-sm resize-none"
      />
    </div>
  </div>
);

// 专家工具配置
interface AgentToolsConfigProps {
  agent: StrategyAgent;
  availableTools: ToolInfo[];
  mcpServers: MCPServerConfig[];
  onToggleTool: (toolName: string) => void;
  onToggleMCPServer: (serverId: string) => void;
}

const AgentToolsConfig: React.FC<AgentToolsConfigProps> = ({
  agent, availableTools, mcpServers, onToggleTool, onToggleMCPServer
}) => {
  const selectedTools = agent.tools || [];
  const selectedMCPServers = agent.mcpServers || [];

  return (
    <div className="space-y-6">
      {/* 内置工具 */}
      <div className="space-y-2">
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm text-slate-400 flex items-center gap-1.5">
            <Wrench className="h-4 w-4" />
            内置工具
            <span className="text-xs text-slate-500">({selectedTools.length}/{availableTools.length})</span>
          </label>
        </div>
        <div className="grid grid-cols-1 gap-2 max-h-48 overflow-y-auto">
          {availableTools.map(tool => {
            const isSelected = selectedTools.includes(tool.name);
            return (
              <div
                key={tool.name}
                onClick={() => onToggleTool(tool.name)}
                className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                  isSelected
                    ? "border-accent/50 bg-accent/10"
                    : "border-slate-700 hover:border-slate-600 hover:bg-slate-800/40"
                }`}
              >
                <div className={`w-5 h-5 rounded flex items-center justify-center shrink-0 ${
                  isSelected ? "bg-accent text-white" : "bg-slate-700 border border-slate-600"
                }`}>
                  {isSelected && <Check className="h-3 w-3" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-white text-sm font-medium">{tool.name}</div>
                  <div className="text-slate-500 text-xs">{tool.description}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* MCP 服务器 */}
      {mcpServers.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm text-slate-400 flex items-center gap-1.5">
              <Plug className="h-4 w-4" />
              MCP 服务器
              <span className="text-xs text-slate-500">({selectedMCPServers.length}/{mcpServers.length})</span>
            </label>
          </div>
          <div className="grid grid-cols-1 gap-2 max-h-48 overflow-y-auto">
            {mcpServers.map(server => {
              const isSelected = selectedMCPServers.includes(server.id);
              return (
                <div
                  key={server.id}
                  onClick={() => onToggleMCPServer(server.id)}
                  className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                    isSelected
                      ? "border-purple-500/50 bg-purple-500/10"
                      : "border-slate-700 hover:border-slate-600 hover:bg-slate-800/40"
                  }`}
                >
                  <div className={`w-5 h-5 rounded flex items-center justify-center shrink-0 ${
                    isSelected ? "bg-purple-500 text-white" : "bg-slate-700 border border-slate-600"
                  }`}>
                    {isSelected && <Check className="h-3 w-3" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-white text-sm font-medium">{server.name}</div>
                    <div className="text-slate-500 text-xs truncate">{server.command} {server.args?.join(' ')}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
