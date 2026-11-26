'use client';

import React, { useState, useEffect } from 'react';
import { RefreshCw, Play, AlertCircle, CheckCircle2, Clock, ShieldCheck, ChevronRight, ChevronDown } from 'lucide-react';

interface Attempt {
  id: number;
  attemptNumber: number;
  workerIdentifier: string;
  startTime: string;
  finishTime: string;
  result: string;
  errorMessage: string | null;
}

interface WebhookEvent {
  id: string;
  event_id: string;
  type: string;
  payload: any;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  attempts: number;
  max_attempts: number;
  next_run_at: string;
  locked_by: string | null;
  locked_until: string | null;
  last_error: string | null;
  order_id: string | null;
  order_processed_at: string | null;
  attempts_history: Attempt[] | null;
  created_at: string;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

export default function OperationsDashboard() {
  const [events, setEvents] = useState<WebhookEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fetchEvents = async () => {
    try {
      const res = await fetch(`${API_BASE}/events`);
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      const data = await res.json();
      setEvents(data);
      setErrorMsg(null);
    } catch (err: any) {
      setErrorMsg(`Could not connect to API (${API_BASE}): ${err.message}`);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchEvents();
    const interval = setInterval(fetchEvents, 2000);
    return () => clearInterval(interval);
  }, []);

  const handleManualRetry = async (eventId: string) => {
    setRetryingId(eventId);
    try {
      const res = await fetch(`${API_BASE}/events/${eventId}/retry`, {
        method: 'POST',
      });
      if (!res.ok) {
        const err = await res.json();
        alert(`Retry failed: ${err.message || 'Unknown error'}`);
      } else {
        await fetchEvents();
      }
    } catch (err: any) {
      alert(`Network error: ${err.message}`);
    } finally {
      setRetryingId(null);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'COMPLETED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <CheckCircle2 className="w-3.5 h-3.5" />
            COMPLETED
          </span>
        );
      case 'PROCESSING':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20 animate-pulse">
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            PROCESSING
          </span>
        );
      case 'FAILED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
            <AlertCircle className="w-3.5 h-3.5" />
            FAILED
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/20">
            <Clock className="w-3.5 h-3.5" />
            PENDING
          </span>
        );
    }
  };

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between pb-6 border-b border-slate-800 gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
            <ShieldCheck className="w-7 h-7 text-indigo-400" />
            Webhook Operations Dashboard
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Monitoring distributed webhook events, worker states, and retry history
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              setRefreshing(true);
              fetchEvents();
            }}
            className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-md transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="mt-4 p-4 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm">
          {errorMsg}
        </div>
      )}

      {/* Metrics Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 my-6">
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
          <div className="text-xs font-medium text-slate-400">Total Events</div>
          <div className="text-2xl font-bold text-white mt-1">{events.length}</div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
          <div className="text-xs font-medium text-emerald-400">Completed Orders</div>
          <div className="text-2xl font-bold text-emerald-400 mt-1">
            {events.filter((e) => e.status === 'COMPLETED').length}
          </div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
          <div className="text-xs font-medium text-amber-400">In Progress / Pending</div>
          <div className="text-2xl font-bold text-amber-400 mt-1">
            {events.filter((e) => e.status === 'PROCESSING' || e.status === 'PENDING').length}
          </div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
          <div className="text-xs font-medium text-rose-400">Permanently Failed</div>
          <div className="text-2xl font-bold text-rose-400 mt-1">
            {events.filter((e) => e.status === 'FAILED').length}
          </div>
        </div>
      </div>

      {/* Events Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-300">
            <thead className="bg-slate-950/60 text-xs uppercase text-slate-400 border-b border-slate-800">
              <tr>
                <th className="px-4 py-3">Event ID</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Attempts</th>
                <th className="px-4 py-3">Assigned Worker</th>
                <th className="px-4 py-3">Order ID</th>
                <th className="px-4 py-3">Simulation</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {events.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                    {loading ? 'Loading events...' : 'No webhook events received yet.'}
                  </td>
                </tr>
              ) : (
                events.map((event) => {
                  const isExpanded = expandedId === event.event_id;
                  const simulateMode = event.payload?.data?.simulate || 'ok';

                  return (
                    <React.Fragment key={event.id}>
                      <tr
                        onClick={() => setExpandedId(isExpanded ? null : event.event_id)}
                        className="hover:bg-slate-800/40 cursor-pointer transition"
                      >
                        <td className="px-4 py-3.5 font-mono text-xs font-semibold text-indigo-300 flex items-center gap-1.5">
                          {isExpanded ? (
                            <ChevronDown className="w-4 h-4 text-slate-400" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-slate-400" />
                          )}
                          {event.event_id}
                        </td>
                        <td className="px-4 py-3.5 text-xs text-slate-300">{event.type}</td>
                        <td className="px-4 py-3.5">{getStatusBadge(event.status)}</td>
                        <td className="px-4 py-3.5 text-xs">
                          <span className="font-semibold text-slate-100">{event.attempts}</span>
                          <span className="text-slate-500"> / {event.max_attempts}</span>
                        </td>
                        <td className="px-4 py-3.5 font-mono text-xs text-slate-400">
                          {event.locked_by || <span className="text-slate-600">—</span>}
                        </td>
                        <td className="px-4 py-3.5 font-mono text-xs text-slate-300">
                          {event.order_id || <span className="text-slate-600">—</span>}
                        </td>
                        <td className="px-4 py-3.5 text-xs font-mono text-amber-400/90">
                          {simulateMode}
                        </td>
                        <td className="px-4 py-3.5 text-right" onClick={(e) => e.stopPropagation()}>
                          {event.status === 'FAILED' ? (
                            <button
                              onClick={() => handleManualRetry(event.event_id)}
                              disabled={retryingId === event.event_id}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded transition shadow"
                            >
                              <Play className="w-3 h-3" />
                              {retryingId === event.event_id ? 'Retrying...' : 'Manual Retry'}
                            </button>
                          ) : (
                            <span className="text-xs text-slate-600">—</span>
                          )}
                        </td>
                      </tr>

                      {/* Expandable Attempt History & Details */}
                      {isExpanded && (
                        <tr className="bg-slate-950/80">
                          <td colSpan={8} className="px-6 py-4">
                            <div className="space-y-4">
                              {event.last_error && (
                                <div className="p-3 rounded bg-rose-500/10 border border-rose-500/20 text-xs font-mono text-rose-300">
                                  <strong>Last Error:</strong> {event.last_error}
                                </div>
                              )}

                              <div>
                                <h4 className="text-xs font-semibold uppercase text-slate-400 tracking-wider mb-2">
                                  Processing Attempts History
                                </h4>
                                {!event.attempts_history || event.attempts_history.length === 0 ? (
                                  <div className="text-xs text-slate-500 italic">No attempts logged yet.</div>
                                ) : (
                                  <div className="border border-slate-800 rounded-lg overflow-hidden">
                                    <table className="w-full text-xs">
                                      <thead className="bg-slate-900 text-slate-400 border-b border-slate-800">
                                        <tr>
                                          <th className="px-3 py-2 text-left">#</th>
                                          <th className="px-3 py-2 text-left">Worker ID</th>
                                          <th className="px-3 py-2 text-left">Result</th>
                                          <th className="px-3 py-2 text-left">Start Time</th>
                                          <th className="px-3 py-2 text-left">Finish Time</th>
                                          <th className="px-3 py-2 text-left">Error Message</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-slate-800">
                                        {event.attempts_history.map((att) => (
                                          <tr key={att.id} className="font-mono">
                                            <td className="px-3 py-2 text-slate-300">{att.attemptNumber}</td>
                                            <td className="px-3 py-2 text-indigo-300">{att.workerIdentifier}</td>
                                            <td className="px-3 py-2">
                                              <span
                                                className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                                  att.result === 'SUCCESS'
                                                    ? 'bg-emerald-500/20 text-emerald-300'
                                                    : att.result === 'PERMANENT_FAILURE'
                                                    ? 'bg-rose-500/20 text-rose-300'
                                                    : 'bg-amber-500/20 text-amber-300'
                                                }`}
                                              >
                                                {att.result}
                                              </span>
                                            </td>
                                            <td className="px-3 py-2 text-slate-400">{new Date(att.startTime).toLocaleTimeString()}</td>
                                            <td className="px-3 py-2 text-slate-400">
                                              {att.finishTime ? new Date(att.finishTime).toLocaleTimeString() : 'In Flight'}
                                            </td>
                                            <td className="px-3 py-2 text-rose-300 truncate max-w-xs" title={att.errorMessage || ''}>
                                              {att.errorMessage || '—'}
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
