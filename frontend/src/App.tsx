import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { StockList } from './components/StockList';
import { StockChart } from './components/StockChart';
import { OrderBook as OrderBookComponent } from './components/OrderBook';
import { F10Panel } from './components/F10Panel';
import { AgentRoom } from './components/AgentRoom';
import { SettingsDialog } from './components/SettingsDialog';
import { PositionDialog } from './components/PositionDialog';
import { HotTrendDialog } from './components/HotTrendDialog';
import { LongHuBangDialog } from './components/LongHuBangDialog';
import { MarketMovesDialog } from './components/MarketMovesDialog';
import { WelcomePage } from './components/WelcomePage';
import { ThemeSwitcher } from './components/ThemeSwitcher';
import { useTheme } from './contexts/ThemeContext';
import { ResizeHandle } from './components/ResizeHandle';
import { getWatchlist, addToWatchlist, removeFromWatchlist } from './services/watchlistService';
import { getKLineData, getOrderBook } from './services/stockService';
import { getF10Overview } from './services/f10Service';
import { getOrCreateSession, StockSession, updateStockPosition } from './services/sessionService';
import { getConfig, updateConfig } from './services/configService';
import { useMarketEvents } from './hooks/useMarketEvents';
import { Stock, KLineData, OrderBook, TimePeriod, Telegraph, MarketIndex, MarketStatus, F10Overview } from './types';
import { Radio, Settings, List, Minus, Square, X, Copy, Briefcase, TrendingUp, BarChart3, Activity } from 'lucide-react';
import logo from './assets/images/logo.png';
import { GetTelegraphList, OpenURL, WindowMinimize, WindowMaximize, WindowClose } from '../wailsjs/go/main/App';
import { WindowIsMaximised, WindowSetSize, WindowGetSize } from '../wailsjs/runtime/runtime';

// 布局配置常量
const LAYOUT_DEFAULTS = {
  leftPanelWidth: 280,
  rightPanelWidth: 384,
  bottomPanelHeight: 120,
};
const LAYOUT_MIN = {
  leftPanelWidth: 280,
  rightPanelWidth: 384,
  bottomPanelHeight: 104,
};
const LAYOUT_MAX = {
  leftPanelWidth: 500,
  rightPanelWidth: 700,
  bottomPanelHeight: 150,
};
const WINDOW_RESTORE_DEFAULT = {
  width: 1366,
  height: 768,
};

const clampLayoutValue = (value: number | undefined, min: number, max: number, fallback: number) => {
  if (typeof value !== 'number' || Number.isNaN(value) || value <= 0) return fallback;
  return Math.max(min, Math.min(max, value));
};

const formatClock = (): string =>
  new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

type WorkspaceMode = 'wide' | 'compact' | 'stacked';
type WorkspaceFocusMode = 'panorama' | 'market' | 'f10' | 'meeting';

const App: React.FC = () => {
  const { colors } = useTheme();
  const [watchlist, setWatchlist] = useState<Stock[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState<string>('');
  const [currentSession, setCurrentSession] = useState<StockSession | null>(null);
  const [timePeriod, setTimePeriod] = useState<TimePeriod>('1m');
  const [kLineData, setKLineData] = useState<KLineData[]>([]);
  const [orderBook, setOrderBook] = useState<OrderBook>({ bids: [], asks: [] });
  const [marketMessage, setMarketMessage] = useState<string>('市场数据加载中...');
  const [telegraphList, setTelegraphList] = useState<Telegraph[]>([]);
  const [showTelegraphList, setShowTelegraphList] = useState(false);
  const [telegraphLoading, setTelegraphLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [showPosition, setShowPosition] = useState(false);
  const [showHotTrend, setShowHotTrend] = useState(false);
  const [showLongHuBang, setShowLongHuBang] = useState(false);
  const [showMarketMoves, setShowMarketMoves] = useState(false);
  const [showF10, setShowF10] = useState(false);
  const [marketStatus, setMarketStatus] = useState<MarketStatus | null>(null);
  const [marketIndices, setMarketIndices] = useState<MarketIndex[]>([]);
  const [isMaximized, setIsMaximized] = useState(false);
  const [clock, setClock] = useState<string>(formatClock);
  const [f10Overview, setF10Overview] = useState<F10Overview | null>(null);
  const [f10Loading, setF10Loading] = useState(false);
  const [f10Error, setF10Error] = useState<string>('');
  const [pendingRemoveSymbol, setPendingRemoveSymbol] = useState<string>('');
  const [isRemovingStock, setIsRemovingStock] = useState(false);

  // 布局状态
  const [leftPanelWidth, setLeftPanelWidth] = useState(LAYOUT_DEFAULTS.leftPanelWidth);
  const [rightPanelWidth, setRightPanelWidth] = useState(LAYOUT_DEFAULTS.rightPanelWidth);
  const [bottomPanelHeight, setBottomPanelHeight] = useState(LAYOUT_DEFAULTS.bottomPanelHeight);
  const [viewportWidth, setViewportWidth] = useState<number>(() =>
    typeof window === 'undefined' ? WINDOW_RESTORE_DEFAULT.width : window.innerWidth,
  );
  const [workspaceFocusMode, setWorkspaceFocusMode] = useState<WorkspaceFocusMode>('panorama');
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const workspaceMode: WorkspaceMode = viewportWidth <= 1220 ? 'stacked' : viewportWidth <= 1580 ? 'compact' : 'wide';
  const isWideWorkspace = workspaceMode === 'wide';
  const showWorkspaceFocusBar = !isWideWorkspace;
  const effectiveBottomPanelHeight = isWideWorkspace
    ? bottomPanelHeight
    : workspaceMode === 'compact'
      ? 136
      : 124;
  const centerPaneShowsF10 = workspaceFocusMode === 'f10' ? true : workspaceFocusMode === 'market' ? false : showF10;
  const visibleLeftPane = isWideWorkspace || workspaceFocusMode === 'panorama';
  const visibleCenterPane =
    isWideWorkspace || workspaceFocusMode === 'panorama' || workspaceFocusMode === 'market' || workspaceFocusMode === 'f10';
  const visibleRightPane = isWideWorkspace || workspaceFocusMode === 'panorama' || workspaceFocusMode === 'meeting';

  const selectedStock = useMemo(() =>
    watchlist.find(s => s.symbol === selectedSymbol) || watchlist[0]
  , [selectedSymbol, watchlist]);
  const pendingRemoveStock = useMemo(
    () => watchlist.find(stock => stock.symbol === pendingRemoveSymbol) || null,
    [watchlist, pendingRemoveSymbol],
  );
  const marketOverview = useMemo(() => {
    if (!selectedStock) {
      return { quote: [], deal: [], capital: [] } as const;
    }

    const valuation = f10Overview?.valuation;
    const latestAvg = kLineData.length > 0 ? kLineData[kLineData.length - 1]?.avg : undefined;
    const quoteAvgCandidate = selectedStock.volume > 0 && selectedStock.amount > 0
      ? selectedStock.amount / selectedStock.volume
      : undefined;
    const isQuoteAvgPlausible = quoteAvgCandidate !== undefined
      && quoteAvgCandidate > selectedStock.price * 0.2
      && quoteAvgCandidate < selectedStock.price * 5;
    const avgPrice = latestAvg
      ?? (isQuoteAvgPlausible ? quoteAvgCandidate : undefined)
      ?? selectedStock.price;
    const amplitude = selectedStock.preClose > 0
      ? ((selectedStock.high - selectedStock.low) / selectedStock.preClose) * 100
      : undefined;
    const changeColor = selectedStock.change >= 0 ? 'text-red-500' : 'text-green-500';

    return {
      quote: [
        { label: '开', value: formatNumberOrDash(selectedStock.open), colorClass: getPriceColorClass(selectedStock.open, selectedStock.preClose) },
        { label: '高', value: formatNumberOrDash(selectedStock.high), colorClass: getPriceColorClass(selectedStock.high, selectedStock.preClose) },
        { label: '低', value: formatNumberOrDash(selectedStock.low), colorClass: getPriceColorClass(selectedStock.low, selectedStock.preClose) },
        { label: '昨', value: formatNumberOrDash(selectedStock.preClose) },
        { label: '振', value: formatPercentOrDash(amplitude) },
      ],
      deal: [
        { label: '量', value: formatVolume(selectedStock.volume) },
        { label: '额', value: formatAmount(selectedStock.amount) },
        { label: 'PE(TTM)', value: formatNumberOrDash(valuation?.peTtm) },
        { label: 'PB', value: formatNumberOrDash(valuation?.pb) },
        { label: '换', value: formatPercentOrDash(valuation?.turnoverRate) },
      ],
      capital: [
        { label: '总', value: formatCapValue(valuation?.totalMarketCap) },
        { label: '流', value: formatCapValue(valuation?.floatMarketCap) },
        { label: '均', value: formatNumberOrDash(avgPrice) },
        { label: '涨', value: `${selectedStock.change >= 0 ? '+' : ''}${selectedStock.changePercent.toFixed(2)}%`, colorClass: changeColor },
      ],
    } as const;
  }, [selectedStock, f10Overview, kLineData]);

  // 处理股票数据更新（来自后端推送）
  const handleStockUpdate = useCallback((stocks: Stock[]) => {
    if (!stocks || !Array.isArray(stocks)) return;
    setWatchlist(prev => {
      // 实时推送里通常不包含行业等静态字段，需保留本地已有值
      return prev.map(stock => {
        const updated = stocks.find(s => s.symbol === stock.symbol);
        if (!updated) return stock;
        return {
          ...stock,
          ...updated,
          name: updated.name || stock.name,
          sector: updated.sector || stock.sector,
          marketCap: updated.marketCap || stock.marketCap,
        };
      });
    });
  }, []);

  // 处理盘口数据更新（来自后端推送）
  const handleOrderBookUpdate = useCallback((data: OrderBook) => {
    setOrderBook(data);
  }, []);

  // 处理快讯数据更新（来自后端推送）
  const handleTelegraphUpdate = useCallback((data: Telegraph) => {
    if (data && data.content) {
      setMarketMessage(`[${data.time}] ${data.content}`);
    }
  }, []);

  // 处理市场状态更新（来自后端推送）
  const handleMarketStatusUpdate = useCallback((status: MarketStatus) => {
    if (status) {
      setMarketStatus(status);
    }
  }, []);

  // 处理大盘指数更新（来自后端推送）
  const handleMarketIndicesUpdate = useCallback((indices: MarketIndex[]) => {
    if (indices) {
      setMarketIndices(indices);
    }
  }, []);

  // 处理K线数据更新（来自后端推送）
  const handleKLineUpdate = useCallback((data: { code: string; period: string; data: KLineData[] }) => {
    // 只更新当前选中股票和周期的K线数据
    if (data && data.code === selectedSymbol && data.period === timePeriod) {
      setKLineData(data.data);
    }
  }, [selectedSymbol, timePeriod]);

  const fetchF10Overview = useCallback(async (symbol: string) => {
    if (!symbol) return;
    setF10Loading(true);
    setF10Error('');
    try {
      const overview = await getF10Overview(symbol);
      setF10Overview(overview);
    } catch (err) {
      console.error('Failed to get F10 overview:', err);
      setF10Error(err instanceof Error ? err.message : '获取F10数据失败');
    } finally {
      setF10Loading(false);
    }
  }, []);

  // 保存布局配置（防抖）
  const saveLayoutConfig = useCallback(async (
    left: number, right: number, bottom: number,
    winWidth?: number, winHeight?: number
  ) => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(async () => {
      try {
        const config = await getConfig();
        const isWindowMaximized = await WindowIsMaximised();
        let windowWidth = config.layout?.windowWidth || WINDOW_RESTORE_DEFAULT.width;
        let windowHeight = config.layout?.windowHeight || WINDOW_RESTORE_DEFAULT.height;
        if (!isWindowMaximized) {
          const size = await WindowGetSize();
          windowWidth = Math.max(WINDOW_RESTORE_DEFAULT.width, winWidth ?? size.w);
          windowHeight = Math.max(WINDOW_RESTORE_DEFAULT.height, winHeight ?? size.h);
        }
        config.layout = {
          leftPanelWidth: left,
          rightPanelWidth: right,
          bottomPanelHeight: bottom,
          windowWidth,
          windowHeight,
        };
        await updateConfig(config);
      } catch (err) {
        console.error('Failed to save layout config:', err);
      }
    }, 500);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handleResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // 左侧面板 resize
  const handleLeftResize = useCallback((delta: number) => {
    setLeftPanelWidth(prev => {
      const newWidth = Math.max(LAYOUT_MIN.leftPanelWidth, Math.min(LAYOUT_MAX.leftPanelWidth, prev + delta));
      return newWidth;
    });
  }, []);

  // 右侧面板 resize
  const handleRightResize = useCallback((delta: number) => {
    setRightPanelWidth(prev => {
      const newWidth = Math.max(LAYOUT_MIN.rightPanelWidth, Math.min(LAYOUT_MAX.rightPanelWidth, prev - delta));
      return newWidth;
    });
  }, []);

  // 底部面板 resize
  const handleBottomResize = useCallback((delta: number) => {
    setBottomPanelHeight(prev => {
      const newHeight = Math.max(LAYOUT_MIN.bottomPanelHeight, Math.min(LAYOUT_MAX.bottomPanelHeight, prev - delta));
      return newHeight;
    });
  }, []);

  // resize 结束时保存配置
  const handleResizeEnd = useCallback(() => {
    saveLayoutConfig(leftPanelWidth, rightPanelWidth, bottomPanelHeight);
  }, [leftPanelWidth, rightPanelWidth, bottomPanelHeight, saveLayoutConfig]);

  // 监听窗口 resize 事件
  useEffect(() => {
    const windowResizeTimeoutRef = { current: null as ReturnType<typeof setTimeout> | null };
    const handleWindowResize = () => {
      if (windowResizeTimeoutRef.current) {
        clearTimeout(windowResizeTimeoutRef.current);
      }
      windowResizeTimeoutRef.current = setTimeout(() => {
        saveLayoutConfig(leftPanelWidth, rightPanelWidth, bottomPanelHeight);
      }, 500);
    };
    window.addEventListener('resize', handleWindowResize);
    return () => {
      window.removeEventListener('resize', handleWindowResize);
      if (windowResizeTimeoutRef.current) {
        clearTimeout(windowResizeTimeoutRef.current);
      }
    };
  }, [leftPanelWidth, rightPanelWidth, bottomPanelHeight, saveLayoutConfig]);

  // 获取快讯列表
  const handleShowTelegraphList = async () => {
    if (!showTelegraphList) {
      setShowTelegraphList(true);
      setTelegraphLoading(true);
      try {
        const list = await GetTelegraphList();
        setTelegraphList(list || []);
      } finally {
        setTelegraphLoading(false);
      }
    } else {
      setShowTelegraphList(false);
    }
  };

  // 打开快讯链接
  const handleOpenTelegraph = (telegraph: Telegraph) => {
    if (telegraph.url) {
      OpenURL(telegraph.url);
    }
    setShowTelegraphList(false);
  };

  const handleShowTrend = useCallback(() => {
    setShowF10(false);
    setWorkspaceFocusMode(prev => (prev === 'f10' ? 'market' : prev));
  }, []);

  const handleShowF10 = useCallback(() => {
    setShowF10(true);
    setWorkspaceFocusMode(prev => (prev === 'market' ? 'f10' : prev));
    if (
      selectedStock?.symbol &&
      (!f10Overview || f10Overview.code !== selectedStock.symbol)
    ) {
      fetchF10Overview(selectedStock.symbol);
    }
  }, [selectedStock, f10Overview, fetchF10Overview]);

  // 使用市场事件 Hook
  const { subscribe, subscribeOrderBook, subscribeKLine } = useMarketEvents({
    onStockUpdate: handleStockUpdate,
    onOrderBookUpdate: handleOrderBookUpdate,
    onTelegraphUpdate: handleTelegraphUpdate,
    onMarketStatusUpdate: handleMarketStatusUpdate,
    onMarketIndicesUpdate: handleMarketIndicesUpdate,
    onKLineUpdate: handleKLineUpdate,
  });

  // Handle Adding Stock
  const handleAddStock = async (newStock: Stock) => {
    if (!watchlist.find(s => s.symbol === newStock.symbol)) {
      await addToWatchlist(newStock);
      setWatchlist(prev => [...prev, newStock]);
      // 添加后自动选中新股票并加载数据
      setSelectedSymbol(newStock.symbol);
      subscribeOrderBook(newStock.symbol);
      // 加载 Session 和盘口数据
      const [session, orderBookData] = await Promise.all([
        getOrCreateSession(newStock.symbol, newStock.name),
        getOrderBook(newStock.symbol)
      ]);
      setCurrentSession(session);
      setOrderBook(orderBookData);
    }
  };

  // Handle Removing Stock
  const handleRemoveStock = (symbol: string) => {
    setPendingRemoveSymbol(symbol);
  };

  const handleCancelRemoveStock = () => {
    if (isRemovingStock) return;
    setPendingRemoveSymbol('');
  };

  const handleConfirmRemoveStock = async () => {
    if (!pendingRemoveSymbol || isRemovingStock) {
      return;
    }
    setIsRemovingStock(true);
    const symbol = pendingRemoveSymbol;

    try {
      await removeFromWatchlist(symbol);
      setWatchlist(prev => prev.filter(s => s.symbol !== symbol));
      setPendingRemoveSymbol('');
      // 如果删除的是当前选中的股票，切换到第一个
      if (symbol === selectedSymbol) {
        const remaining = watchlist.filter(s => s.symbol !== symbol);
        if (remaining.length > 0) {
          handleSelectStock(remaining[0].symbol);
        }
      }
    } finally {
      setIsRemovingStock(false);
    }
  };

  // Handle Stock Selection - Load Session and sync data
  const handleSelectStock = async (symbol: string) => {
    setSelectedSymbol(symbol);
    // 订阅该股票的盘口推送
    subscribeOrderBook(symbol);
    const stock = watchlist.find(s => s.symbol === symbol);
    if (stock) {
      // 并行加载 Session 和盘口数据
      const [session, orderBookData] = await Promise.all([
        getOrCreateSession(symbol, stock.name),
        getOrderBook(symbol)
      ]);
      setCurrentSession(session);
      setOrderBook(orderBookData);
    }
  };

  // Handle Market Index Selection - ensure index can be clicked from left-top panel
  const handleSelectIndex = async (index: MarketIndex) => {
    const existing = watchlist.find(s => s.symbol === index.code);
    if (existing) {
      await handleSelectStock(index.code);
      return;
    }

    const indexStock: Stock = {
      symbol: index.code,
      name: index.name,
      price: index.price,
      change: index.change,
      changePercent: index.changePercent,
      volume: index.volume,
      amount: index.amount,
      marketCap: '',
      sector: '指数',
      open: 0,
      high: 0,
      low: 0,
      preClose: 0,
    };
    await handleAddStock(indexStock);
  };

  // Load watchlist on mount
  useEffect(() => {
    const loadWatchlist = async () => {
      try {
        // 加载布局配置
        const config = await getConfig();
        if (config.layout) {
          setLeftPanelWidth(
            clampLayoutValue(
              config.layout.leftPanelWidth,
              LAYOUT_MIN.leftPanelWidth,
              LAYOUT_MAX.leftPanelWidth,
              LAYOUT_DEFAULTS.leftPanelWidth,
            ),
          );
          setRightPanelWidth(
            clampLayoutValue(
              config.layout.rightPanelWidth,
              LAYOUT_MIN.rightPanelWidth,
              LAYOUT_MAX.rightPanelWidth,
              LAYOUT_DEFAULTS.rightPanelWidth,
            ),
          );
          setBottomPanelHeight(
            clampLayoutValue(
              config.layout.bottomPanelHeight,
              LAYOUT_MIN.bottomPanelHeight,
              LAYOUT_MAX.bottomPanelHeight,
              LAYOUT_DEFAULTS.bottomPanelHeight,
            ),
          );
          // 恢复窗口大小：仅在非最大化状态下设置，避免破坏最大化/还原行为
          const isWindowMaximized = await WindowIsMaximised();
          if (!isWindowMaximized) {
            const restoreWidth = Math.max(WINDOW_RESTORE_DEFAULT.width, config.layout.windowWidth || WINDOW_RESTORE_DEFAULT.width);
            const restoreHeight = Math.max(WINDOW_RESTORE_DEFAULT.height, config.layout.windowHeight || WINDOW_RESTORE_DEFAULT.height);
            await WindowSetSize(restoreWidth, restoreHeight);
          }
        }

        const list = await getWatchlist();
        setWatchlist(list);
        if (list.length > 0) {
          setSelectedSymbol(list[0].symbol);
          // 订阅第一个股票的盘口推送
          subscribeOrderBook(list[0].symbol);
          // 加载第一个股票的Session
          const session = await getOrCreateSession(list[0].symbol, list[0].name);
          setCurrentSession(session);
        }
        // 主动获取一次快讯数据（解决启动时后端推送早于前端监听注册的时序问题）
        const telegraphs = await GetTelegraphList();
        if (telegraphs && telegraphs.length > 0) {
          const latest = telegraphs[0];
          setMarketMessage(`[${latest.time}] ${latest.content}`);
        }
      } catch (err) {
        console.error('Failed to load watchlist:', err);
      } finally {
        setLoading(false);
      }
    };
    loadWatchlist();
  }, [subscribeOrderBook]);

  // Load K-line data when symbol or period changes
  useEffect(() => {
    if (!selectedSymbol) return;
    // 切换时先清空数据，避免闪烁
    setKLineData([]);
    // 订阅K线推送
    subscribeKLine(selectedSymbol, timePeriod);
    const loadKLineData = async () => {
      // 分时图需要更多数据点（1分钟K线，一天约240根）
      const dataLen = timePeriod === '1m' ? 250 : 60;
      const data = await getKLineData(selectedSymbol, timePeriod, dataLen);
      setKLineData(data);
    };
    loadKLineData();
  }, [selectedSymbol, timePeriod, subscribeKLine]);

  // 初始化窗口最大化状态
  useEffect(() => {
    const syncMaximizedState = () => {
      WindowIsMaximised().then(setIsMaximized).catch(() => {});
    };
    syncMaximizedState();
    window.addEventListener('resize', syncMaximizedState);
    return () => {
      window.removeEventListener('resize', syncMaximizedState);
    };
  }, []);

  useEffect(() => {
    if (selectedSymbol) {
      fetchF10Overview(selectedSymbol);
    }
  }, [selectedSymbol, fetchF10Overview]);

  useEffect(() => {
    const timer = setInterval(() => {
      setClock(formatClock());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!pendingRemoveSymbol) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isRemovingStock) {
        setPendingRemoveSymbol('');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [pendingRemoveSymbol, isRemovingStock]);

  // 自选股代码变化时同步后端订阅，避免新增/删除后实时价格滞后
  const watchlistSymbolKey = useMemo(
    () => watchlist.map(stock => stock.symbol).filter(Boolean).join(','),
    [watchlist],
  );

  useEffect(() => {
    if (!watchlistSymbolKey) return;
    subscribe(watchlistSymbolKey.split(','));
  }, [watchlistSymbolKey, subscribe]);

  if (loading) return <div className="h-screen w-screen flex items-center justify-center fin-app text-white">加载中...</div>;

  // 没有自选股时显示欢迎页面
  if (watchlist.length === 0) {
    return <WelcomePage onAddStock={handleAddStock} />;
  }

  if (!selectedStock) return <div className="h-screen w-screen flex items-center justify-center fin-app text-white">请添加自选股</div>;

  return (
    <div className="flex flex-col h-screen text-slate-100 font-sans fin-app app-shell">
      {/* Top Navbar */}
      <header className="h-16 fin-panel border-b fin-divider flex items-center px-5 justify-between shrink-0 z-20" style={{ '--wails-draggable': 'drag' } as React.CSSProperties}>
        <div className="flex items-center gap-2" style={{ '--wails-draggable': 'no-drag' } as React.CSSProperties}>
          <img src={logo} alt="logo" className="h-8 w-8 rounded-lg" />
          <span className={`font-bold text-lg tracking-tight ${colors.isDark ? 'text-white' : 'text-slate-800'}`}>韭菜盘 <span className="text-accent-2">AI</span></span>
        </div>
        
        <div className="flex items-center gap-4 fin-panel-soft px-4 py-2 rounded-full border fin-divider relative shadow-[0_10px_24px_rgba(0,0,0,0.18)]" style={{ '--wails-draggable': 'no-drag' } as React.CSSProperties}>
          <Radio className="h-3 w-3 animate-pulse text-accent-2" />
          <span className={`text-xs font-mono w-96 truncate text-center ${colors.isDark ? 'text-slate-300' : 'text-slate-600'}`}>
            实时快讯: {marketMessage}
          </span>
          <button
            onClick={handleShowTelegraphList}
            className={`p-1 rounded transition-colors ${colors.isDark ? 'hover:bg-slate-700/50 text-slate-400' : 'hover:bg-slate-200/50 text-slate-500'} hover:text-accent-2`}
            title="查看快讯列表"
          >
            <List className="h-4 w-4" />
          </button>

          {/* 快讯下拉列表 */}
          {showTelegraphList && (
            <div
              className="absolute top-full left-0 right-0 mt-2 fin-panel border fin-divider rounded-lg shadow-xl z-50 max-h-96 overflow-y-auto fin-scrollbar"
              onMouseLeave={() => setShowTelegraphList(false)}
            >
              <div className={`p-2 border-b fin-divider text-xs font-medium ${colors.isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                财联社快讯
              </div>
              {telegraphLoading ? (
                <div className={`p-4 text-center text-sm ${colors.isDark ? 'text-slate-500' : 'text-slate-400'}`}>加载中...</div>
              ) : telegraphList.length === 0 ? (
                <div className={`p-4 text-center text-sm ${colors.isDark ? 'text-slate-500' : 'text-slate-400'}`}>暂无快讯</div>
              ) : (
                telegraphList.map((tg, idx) => (
                  <div
                    key={idx}
                    onClick={() => handleOpenTelegraph(tg)}
                    className={`p-3 border-b fin-divider last:border-b-0 cursor-pointer transition-colors ${colors.isDark ? 'hover:bg-slate-800/50' : 'hover:bg-slate-100/80'}`}
                  >
                    <div className="flex items-start gap-2">
                      <span className="text-xs text-accent-2 font-mono shrink-0">{tg.time}</span>
                      <span className={`text-xs line-clamp-2 ${colors.isDark ? 'text-slate-300' : 'text-slate-600'}`}>{tg.content}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-3" style={{ '--wails-draggable': 'no-drag' } as React.CSSProperties}>
          <button
            onClick={() => setShowLongHuBang(true)}
            className={`p-2 rounded-lg fin-panel border fin-divider transition-colors ${colors.isDark ? 'text-slate-300 hover:text-white' : 'text-slate-600 hover:text-slate-900'} hover:border-red-400/40`}
            title="龙虎榜"
          >
            <BarChart3 className="h-4 w-4" />
          </button>
          <button
            onClick={() => setShowHotTrend(true)}
            className={`p-2 rounded-lg fin-panel border fin-divider transition-colors ${colors.isDark ? 'text-slate-300 hover:text-white' : 'text-slate-600 hover:text-slate-900'} hover:border-orange-400/40`}
            title="全网热点"
          >
            <TrendingUp className="h-4 w-4" />
          </button>
          <button
            onClick={() => setShowMarketMoves(true)}
            className={`p-2 rounded-lg fin-panel border fin-divider transition-colors ${colors.isDark ? 'text-slate-300 hover:text-white' : 'text-slate-600 hover:text-slate-900'} hover:border-cyan-400/40`}
            title="异动中心"
          >
            <Activity className="h-4 w-4" />
          </button>
          <ThemeSwitcher />
          <button
            onClick={() => setShowSettings(true)}
            className={`p-2 rounded-lg fin-panel border fin-divider transition-colors ${colors.isDark ? 'text-slate-300 hover:text-white' : 'text-slate-600 hover:text-slate-900'} hover:border-accent/40`}
          >
            <Settings className="h-4 w-4" />
          </button>
          <div className="text-xs text-right hidden md:block">
            <div className={colors.isDark ? 'text-slate-400' : 'text-slate-500'}>市场状态</div>
            <div className={`font-bold ${
              marketStatus?.status === 'trading' ? 'text-green-500' :
              marketStatus?.status === 'pre_market' ? 'text-yellow-500' :
              marketStatus?.status === 'lunch_break' ? 'text-orange-500' :
              colors.isDark ? 'text-slate-500' : 'text-slate-400'
            }`}>
              {marketStatus?.statusText || '加载中...'}
            </div>
            <div className={`font-mono text-[11px] mt-0.5 ${colors.isDark ? 'text-slate-500' : 'text-slate-400'}`}>
              {clock}
            </div>
          </div>
          {/* 窗口控制按钮 */}
          <div className="flex items-center ml-2 border-l fin-divider pl-3">
            <button
              onClick={() => WindowMinimize()}
              className={`p-1.5 rounded transition-colors ${colors.isDark ? 'hover:bg-slate-700/50 text-slate-400 hover:text-white' : 'hover:bg-slate-200/50 text-slate-500 hover:text-slate-900'}`}
              title="最小化"
            >
              <Minus className="h-4 w-4" />
            </button>
            <button
              onClick={async () => {
                await WindowMaximize();
                const maximized = await WindowIsMaximised();
                setIsMaximized(maximized);
              }}
              className={`p-1.5 rounded transition-colors ${colors.isDark ? 'hover:bg-slate-700/50 text-slate-400 hover:text-white' : 'hover:bg-slate-200/50 text-slate-500 hover:text-slate-900'}`}
              title={isMaximized ? "还原" : "最大化"}
            >
              {isMaximized ? <Copy className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
            </button>
            <button
              onClick={() => WindowClose()}
              className={`p-1.5 rounded hover:bg-red-500/80 hover:text-white transition-colors ${colors.isDark ? 'text-slate-400' : 'text-slate-500'}`}
              title="关闭"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Grid */}
      <div className={`workspace-shell workspace-${workspaceMode} flex-1 overflow-hidden px-3 pb-3 pt-3 gap-3`}>
        {showWorkspaceFocusBar && (
          <div className="workspace-focusbar app-surface">
            <div className="workspace-focusbar-copy">
              <div className={`text-[11px] uppercase tracking-[0.2em] ${colors.isDark ? 'text-slate-500' : 'text-slate-400'}`}>快速切换</div>
              <div className={`text-xs mt-1 ${colors.isDark ? 'text-slate-300' : 'text-slate-600'}`}>小窗口下优先聚焦当前最重要的一块</div>
            </div>
            <div className="workspace-focusbar-actions">
              {[
                { id: 'panorama' as WorkspaceFocusMode, label: '全景' },
                { id: 'market' as WorkspaceFocusMode, label: '行情' },
                { id: 'f10' as WorkspaceFocusMode, label: 'F10' },
                { id: 'meeting' as WorkspaceFocusMode, label: '会议' },
              ].map(item => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setWorkspaceFocusMode(item.id);
                    if (item.id === 'market') {
                      setShowF10(false);
                    }
                    if (item.id === 'f10') {
                      handleShowF10();
                    }
                  }}
                  className={`workspace-focus-button ${
                    workspaceFocusMode === item.id
                      ? 'border-accent text-accent-2 bg-accent/10'
                      : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Left Sidebar: Watchlist */}
        {visibleLeftPane && (
          <div
            style={isWideWorkspace ? { width: leftPanelWidth } : undefined}
            className={`workspace-pane workspace-left shrink-0 app-surface app-sidebar-shell overflow-hidden ${
              !isWideWorkspace && workspaceFocusMode !== 'panorama' ? 'workspace-pane-focus' : ''
            }`}
          >
            <StockList
              stocks={watchlist}
              selectedSymbol={selectedSymbol}
              onSelect={handleSelectStock}
              onAddStock={handleAddStock}
              onRemoveStock={handleRemoveStock}
              marketIndices={marketIndices}
              selectedIndexCode={selectedSymbol}
              onSelectIndex={handleSelectIndex}
            />
          </div>
        )}

        {/* Left Resize Handle */}
        {isWideWorkspace && (
          <div className="workspace-resize-handle">
            <ResizeHandle direction="horizontal" onResize={handleLeftResize} onResizeEnd={handleResizeEnd} />
          </div>
        )}

        {/* Center Panel: Charts & Data */}
        {visibleCenterPane && (
        <div className={`workspace-pane workspace-center flex-1 flex flex-col min-w-0 app-surface app-main-shell relative z-0 ${
          !isWideWorkspace && workspaceFocusMode !== 'panorama' ? 'workspace-pane-focus' : ''
        }`}>
          <div className="workspace-stock-header px-6 py-5 shrink-0 border-b fin-divider-soft">
            <div className="workspace-stock-header-inner flex items-start justify-between gap-6">
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-3">
                  <span className={`text-[1.7rem] leading-none font-bold tracking-tight ${colors.isDark ? 'text-white' : 'text-slate-800'}`}>{selectedStock.name}</span>
                  <span className={`text-sm font-mono px-3 py-1 rounded-full border fin-divider fin-chip ${colors.isDark ? 'text-slate-300' : 'text-slate-600'}`}>{selectedStock.symbol}</span>
                  <span className={`text-[11px] uppercase tracking-[0.22em] ${colors.isDark ? 'text-slate-500' : 'text-slate-400'}`}>全景分析工作台</span>
                </div>
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] ${colors.isDark ? 'border-slate-700 text-slate-300 bg-slate-900/45' : 'border-slate-300 text-slate-600 bg-white/65'}`}>
                    <span className="h-2 w-2 rounded-full bg-emerald-400" />
                    行情 / 会议 / F10 三栏并行
                  </span>
                  <span className={`text-xs ${colors.isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                    先看全景，再决定深挖路径
                  </span>
                </div>
                <button
                  onClick={() => setShowPosition(true)}
                  className={`inline-flex items-center gap-2 px-3 py-2 rounded-2xl text-xs transition-colors ${colors.isDark ? 'text-slate-300 hover:bg-slate-800/60 bg-slate-900/40 border border-slate-700/60' : 'text-slate-600 hover:bg-slate-100 bg-white/70 border border-slate-200'} hover:text-accent-2`}
                  title="持仓设置"
                >
                  <Briefcase className="h-3.5 w-3.5" />
                  {currentSession?.position && currentSession.position.shares > 0 ? (
                    (() => {
                      const pos = currentSession.position;
                      const marketValue = pos.shares * selectedStock.price;
                      const costAmount = pos.shares * pos.costPrice;
                      const profitLoss = marketValue - costAmount;
                      const profitPercent = costAmount > 0 ? (profitLoss / costAmount) * 100 : 0;
                      const isProfit = profitLoss >= 0;
                      return (
                        <span className={isProfit ? 'text-red-500' : 'text-green-500'}>
                          {pos.shares}股 {isProfit ? '+' : ''}{profitLoss.toFixed(0)} ({isProfit ? '+' : ''}{profitPercent.toFixed(2)}%)
                        </span>
                      );
                    })()
                  ) : (
                    <span>设置持仓</span>
                  )}
                </button>
              </div>
              <div className="flex flex-col items-end gap-3">
                <div className={`text-4xl leading-none font-mono font-bold ${selectedStock.change >= 0 ? 'text-red-500' : 'text-green-500'}`}>
                  {selectedStock.price.toFixed(2)}
                </div>
                <div className="flex flex-wrap items-center justify-end gap-3 text-sm">
                  <span className={`font-mono ${selectedStock.change >= 0 ? 'text-red-500' : 'text-green-500'}`}>
                    {selectedStock.change >= 0 ? '+' : ''}{selectedStock.change.toFixed(2)}
                  </span>
                  <span className={`font-mono px-3 py-1 rounded-full border ${selectedStock.change >= 0 ? 'border-red-500/25 bg-red-500/10 text-red-400' : 'border-emerald-500/25 bg-emerald-500/10 text-green-400'}`}>
                    {selectedStock.change >= 0 ? '+' : ''}{selectedStock.changePercent.toFixed(2)}%
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="border-b fin-divider-soft shrink-0">
            <div className="market-strip">
              {[
                { key: 'quote', title: '即时行情', note: '盘面快照', items: marketOverview.quote, gridClass: 'quote' },
                { key: 'deal', title: '成交估值', note: '量价与估值', items: marketOverview.deal, gridClass: 'deal' },
                { key: 'capital', title: '市值资金', note: '规模与强弱', items: marketOverview.capital, gridClass: 'capital' },
              ].map((group) => (
                <div key={group.key} className="market-overview-card">
                  <div className="market-overview-title">
                    <span className="market-overview-heading">{group.title}</span>
                    <span className="market-overview-note">{group.note}</span>
                  </div>
                  <div className={`market-overview-grid ${group.gridClass}`}>
                    {group.items.map((item) => (
                      <div key={item.label} className="market-overview-item">
                        <span className="market-overview-label">{item.label}</span>
                        <span className={`market-overview-value ${('colorClass' in item && item.colorClass) || ''}`}>{item.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="workspace-viewbar px-5 py-3 border-b fin-divider-soft shrink-0 flex items-center justify-between gap-4">
            <div>
              <div className={`text-[11px] uppercase tracking-[0.2em] ${colors.isDark ? 'text-slate-500' : 'text-slate-400'}`}>主分析区</div>
              <div className={`text-sm mt-1 ${colors.isDark ? 'text-slate-300' : 'text-slate-600'}`}>趋势图负责看节奏，F10 负责看逻辑与基本面</div>
            </div>
            <div className="fin-view-switch">
              <button
                type="button"
                onClick={handleShowTrend}
                className={`transition-colors ${
                  !showF10
                    ? 'border-accent text-accent-2 bg-accent/10'
                    : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                }`}
              >
                趋势图
              </button>
              <button
                type="button"
                onClick={handleShowF10}
                className={`transition-colors ${
                  showF10
                    ? 'border-accent text-accent-2 bg-accent/10'
                    : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                }`}
              >
                F10 全景
              </button>
            </div>
          </div>

          <div className="flex-1 flex flex-col min-h-0 relative z-0">
            {!centerPaneShowsF10 ? (
              <>
                <div className="flex-1 relative min-h-0 chart-stage">
                  <StockChart
                    data={kLineData}
                    period={timePeriod}
                    onPeriodChange={setTimePeriod}
                    stock={selectedStock}
                    floatShares={f10Overview?.valuation?.floatShares}
                    fallbackTurnoverRate={f10Overview?.valuation?.turnoverRate}
                  />
                </div>

                {isWideWorkspace && (
                  <div className="workspace-resize-handle workspace-resize-handle-vertical">
                    <ResizeHandle direction="vertical" onResize={handleBottomResize} onResizeEnd={handleResizeEnd} />
                  </div>
                )}

                <div style={{ height: effectiveBottomPanelHeight }} className="border-t fin-divider-soft flex shrink-0 bottom-stage">
                  <div className="flex-1 overflow-hidden relative app-surface rounded-[22px]">
                    <OrderBookComponent data={orderBook} />
                  </div>
                </div>
              </>
            ) : (
              <div className="flex-1 min-h-0 border-t fin-divider-soft overflow-hidden">
                <F10Panel
                  overview={f10Overview}
                  loading={f10Loading}
                  error={f10Error}
                  onRefresh={() => fetchF10Overview(selectedStock.symbol)}
                  onCollapse={() => setShowF10(false)}
                />
              </div>
            )}
          </div>
        </div>
        )}

        {/* Right Resize Handle */}
        {isWideWorkspace && (
          <div className="workspace-resize-handle">
            <ResizeHandle direction="horizontal" onResize={handleRightResize} onResizeEnd={handleResizeEnd} />
          </div>
        )}

        {/* Right Panel: AI Agents */}
        {visibleRightPane && (
          <div
            style={isWideWorkspace ? { width: rightPanelWidth } : undefined}
            className={`workspace-pane workspace-right shrink-0 app-surface app-sidebar-shell overflow-hidden ${
              !isWideWorkspace && workspaceFocusMode !== 'panorama' ? 'workspace-pane-focus' : ''
            }`}
          >
            <AgentRoom
              session={currentSession}
              onSessionUpdate={setCurrentSession}
            />
          </div>
        )}
      </div>

      {pendingRemoveSymbol && (
        <div
          className="fixed inset-0 z-[220] flex items-center justify-center bg-black/45"
          onClick={handleCancelRemoveStock}
        >
          <div
            className={`w-[360px] max-w-[92vw] rounded-xl border fin-divider shadow-2xl fin-panel p-4 ${
              colors.isDark ? 'bg-slate-900/95' : 'bg-white/95'
            }`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className={`text-sm font-semibold ${colors.isDark ? 'text-slate-100' : 'text-slate-800'}`}>
              删除确认
            </div>
            <div className={`text-xs mt-2 leading-6 ${colors.isDark ? 'text-slate-300' : 'text-slate-600'}`}>
              确认删除自选股「{pendingRemoveStock?.name || '--'} {pendingRemoveSymbol}」吗？
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={handleCancelRemoveStock}
                disabled={isRemovingStock}
                className={`px-3 py-1.5 rounded border text-xs transition-colors ${
                  colors.isDark
                    ? 'border-slate-600 text-slate-300 hover:bg-slate-800'
                    : 'border-slate-300 text-slate-600 hover:bg-slate-100'
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleConfirmRemoveStock}
                disabled={isRemovingStock}
                className="px-3 py-1.5 rounded border border-red-500/40 text-xs text-red-300 hover:bg-red-500/15 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isRemovingStock ? '删除中...' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      )}

      <SettingsDialog isOpen={showSettings} onClose={() => setShowSettings(false)} />
      <PositionDialog
        isOpen={showPosition}
        onClose={() => setShowPosition(false)}
        stockCode={selectedStock.symbol}
        stockName={selectedStock.name}
        currentPrice={selectedStock.price}
        position={currentSession?.position}
        onSave={async (shares, costPrice) => {
          const result = await updateStockPosition(selectedStock.symbol, shares, costPrice);
          if (result !== 'success') {
            throw new Error(result || '持仓保存失败');
          }
          const session = await getOrCreateSession(selectedStock.symbol, selectedStock.name);
          setCurrentSession(session);
        }}
      />
      <HotTrendDialog isOpen={showHotTrend} onClose={() => setShowHotTrend(false)} />
      <LongHuBangDialog isOpen={showLongHuBang} onClose={() => setShowLongHuBang(false)} />
      <MarketMovesDialog isOpen={showMarketMoves} onClose={() => setShowMarketMoves(false)} />
    </div>
  );
};

const formatNumberOrDash = (value?: number, digits = 2): string => {
  if (value === undefined || value === null || Number.isNaN(value)) return '--';
  return value.toFixed(digits);
};

const formatPercentOrDash = (value?: number): string => {
  if (value === undefined || value === null || Number.isNaN(value)) return '--';
  return `${value.toFixed(2)}%`;
};

const formatCapValue = (value?: number): string => {
  if (value === undefined || value === null || Number.isNaN(value) || value <= 0) return '--';
  if (value >= 100000000) return `${(value / 100000000).toFixed(2)}亿`;
  return value.toFixed(2);
};

const getPriceColorClass = (value?: number, preClose?: number): string | undefined => {
  if (value === undefined || preClose === undefined || Number.isNaN(value) || Number.isNaN(preClose)) return undefined;
  if (value > preClose) return 'text-red-500';
  if (value < preClose) return 'text-green-500';
  return undefined;
};

// 格式化成交量
const formatVolume = (vol: number): string => {
  if (vol >= 100000000) return (vol / 100000000).toFixed(2) + '亿';
  if (vol >= 10000) return (vol / 10000).toFixed(2) + '万';
  return vol.toString();
};

// 格式化成交额
const formatAmount = (amount: number): string => {
  if (amount >= 100000000) return (amount / 100000000).toFixed(2) + '亿';
  if (amount >= 10000) return (amount / 10000).toFixed(2) + '万';
  return amount.toFixed(2);
};

export default App;
