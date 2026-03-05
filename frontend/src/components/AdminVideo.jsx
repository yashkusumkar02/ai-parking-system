import React, { useEffect, useState } from 'react';
import { videoService, parkingService } from '../services/api';
import { toast } from 'react-hot-toast';

const AdminVideo = () => {
  const [analyses, setAnalyses] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedLot, setSelectedLot] = useState('');
  const [lots, setLots] = useState([]);
  const [file, setFile] = useState(null);
  const [expandedAnalysis, setExpandedAnalysis] = useState(null);

  const loadAnalyses = async () => {
    setLoading(true);
    try {
      const res = await videoService.getRecentAnalyses(50);
      if (res.data?.success) {
        setAnalyses(res.data.data || res.data.analyses || []);
        console.log('Loaded analyses:', res.data.data || res.data.analyses);
      }
    } catch (e) {
      console.error('Error loading analyses:', e);
      toast.error('Failed to load video analyses');
    } finally {
      setLoading(false);
    }
  };

  const deleteAnalysis = async (id) => {
    const item = analyses.find(a => a.id === id);
    if (!item) return;

    if (item.processing_status === 'processing') {
      const confirmForce = window.confirm('This analysis is processing. Force delete now? This will stop and remove it.');
      if (!confirmForce) return;
    } else if (item.processing_status === 'pending') {
      const confirmCancel = window.confirm('This analysis is pending. Cancel and delete?');
      if (!confirmCancel) return;
      try {
        await videoService.cancelAnalysis(id);
      } catch (e) {
        return toast.error(e?.response?.data?.message || 'Cancel failed');
      }
    } else {
      if (!window.confirm('Delete this analysis?')) return;
    }
    try {
      await videoService.deleteAnalysis(id);
      toast.success('Analysis deleted');
      loadAnalyses();
    } catch (e) {
      toast.error('Delete failed');
    }
  };

  const cancelProcessing = async (id) => {
    const item = analyses.find(a => a.id === id);
    if (!item) return;
    if (item.processing_status !== 'pending') {
      return toast.error('Only pending analyses can be cancelled');
    }
    if (!window.confirm('Cancel this pending video processing?')) return;
    try {
      await videoService.cancelAnalysis(id);
      toast.success('Processing cancelled');
      await loadAnalyses();
    } catch (e) {
      toast.error('Cancel failed');
    }
  };

  const editAnalysis = (id) => {
    toast('Edit functionality not implemented yet');
    // Implement your edit logic here (e.g., open a modal)
  };

  const deleteIfPending = async (id) => {
    const item = analyses.find(a => a.id === id);
    if (!item) return;
    if (item.processing_status !== 'pending') return toast('Not pending');
    if (!window.confirm('Delete this pending analysis?')) return;
    try {
      await videoService.deleteAnalysis(id);
      toast.success('Pending analysis deleted');
      loadAnalyses();
    } catch (e) {
      toast.error('Delete failed');
    }
  };

  useEffect(() => { loadAnalyses(); }, []);
  useEffect(() => { (async()=>{ try { const res = await parkingService.getAllParkingLots(); if (res.data?.success) setLots(res.data.data.parking_lots || res.data.data || []); } catch {} })(); }, []);

  const upload = async () => {
    if (!file || !selectedLot) return toast.error('Select lot and file');
    try {
      const form = new FormData();
      form.append('video', file);
      form.append('parking_lot_id', selectedLot);
      form.append('analysis_type', 'full');
      console.log('Uploading video:', file.name, 'to lot:', selectedLot);
      const response = await videoService.uploadVideo(form);
      console.log('Upload response:', response);
      toast.success('Upload started');
      setFile(null);
      setTimeout(loadAnalyses, 2000); // Wait 2 seconds before refreshing
    } catch (error) {
      console.error('Upload error:', error);
      toast.error(error.response?.data?.message || error.message || 'Upload failed');
    }
  };

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <select className="form-input" value={selectedLot} onChange={(e)=>setSelectedLot(e.target.value)}>
          <option value="">Select lot</option>
          {lots.map(l => (<option key={l.id} value={l.id}>{l.name}</option>))}
        </select>
        <input className="form-input" type="file" accept="video/*" onChange={(e)=>setFile(e.target.files?.[0]||null)} />
        <button className="btn btn-primary" onClick={upload}>Upload</button>
        <button className="btn btn-outline" onClick={loadAnalyses}>Refresh</button>
      </div>
      {loading && <div>Loading...</div>}
      <div className="overflow-x-auto">
        <table className="min-w-full bg-white border">
          <thead>
            <tr className="bg-gray-50">
              <th className="px-4 py-2 text-left">ID</th>
              <th className="px-4 py-2 text-left">Lot</th>
              <th className="px-4 py-2 text-left">File</th>
              <th className="px-4 py-2 text-left">Status</th>
              <th className="px-4 py-2 text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(Array.isArray(analyses) ? analyses : []).map(a => (
              <React.Fragment key={a.id}>
                <tr className="border-t">
                  <td className="px-4 py-2">{a.id}</td>
                  <td className="px-4 py-2">{a.parking_lot_id}</td>
                  <td className="px-4 py-2">{a.video_filename}</td>
                  <td className="px-4 py-2">
                    <span className={`px-2 py-1 rounded text-xs ${
                      a.processing_status === 'completed' ? 'bg-green-100 text-green-800' :
                      a.processing_status === 'processing' ? 'bg-blue-100 text-blue-800' :
                      a.processing_status === 'failed' ? 'bg-red-100 text-red-800' :
                      'bg-yellow-100 text-yellow-800'
                    }`}>{a.processing_status}</span>
                  </td>
                  <td className="px-4 py-2 flex gap-2 flex-wrap">
                    <button className="btn btn-outline text-xs" onClick={() => setExpandedAnalysis(expandedAnalysis === a.id ? null : a.id)}>
                      {expandedAnalysis === a.id ? 'Hide Details' : 'Show Details'}
                    </button>
                    {a.processing_status === 'completed' && (
                      <button className="btn btn-primary text-xs" onClick={() => toast('Results shown below')}>
                        View Results
                      </button>
                    )}
                    {a.processing_status === 'pending' && (
                      <>
                        <button className="btn btn-outline text-xs" onClick={() => cancelProcessing(a.id)}>Cancel</button>
                        <button className="btn btn-outline text-xs" onClick={() => deleteIfPending(a.id)}>Delete</button>
                      </>
                    )}
                    {a.processing_status !== 'pending' && (
                      <button className="btn btn-danger text-xs" onClick={() => deleteAnalysis(a.id)}>Delete</button>
                    )}
                  </td>
                </tr>
                {expandedAnalysis === a.id && (
                  <tr>
                    <td colSpan="5" className="px-4 py-4 bg-gray-50">
                      <div className="text-sm">
                        <h4 className="font-semibold mb-2">Analysis Details</h4>
                        <p><strong>Status:</strong> {a.processing_status}</p>
                        <p><strong>Created:</strong> {new Date(a.created_at).toLocaleString()}</p>
                        {a.analysis_data && (
                          <div className="mt-3">
                            <h5 className="font-medium mb-2">Analysis Data:</h5>
                            <pre className="bg-white p-3 rounded border overflow-auto max-h-64 text-xs">
                              {JSON.stringify(a.analysis_data, null, 2)}
                            </pre>
                          </div>
                        )}
                        {a.processing_status === 'completed' && a.analysis_data?.slot_detections && (
                          <div className="mt-4">
                            <h5 className="font-medium mb-2">Detection Results:</h5>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                              <div className="bg-white p-3 rounded border">
                                <div className="text-xs text-gray-600">Total Detections</div>
                                <div className="text-2xl font-bold">{a.analysis_data.slot_detections.length}</div>
                              </div>
                              <div className="bg-white p-3 rounded border">
                                <div className="text-xs text-gray-600">Vehicles Detected</div>
                                <div className="text-2xl font-bold">{a.analysis_data.vehicle_count || 0}</div>
                              </div>
                              <div className="bg-white p-3 rounded border">
                                <div className="text-xs text-gray-600">Occupancy Rate</div>
                                <div className="text-2xl font-bold">{(a.analysis_data.occupancy_rate || 0).toFixed(1)}%</div>
                              </div>
                              <div className="bg-white p-3 rounded border">
                                <div className="text-xs text-gray-600">Confidence</div>
                                <div className="text-2xl font-bold">{((a.analysis_data.confidence_scores?.overall || 0) * 100).toFixed(1)}%</div>
                              </div>
                            </div>
                            <div className="mt-4">
                              <h6 className="font-medium mb-2">Slot-by-Slot Detection:</h6>
                              <div className="grid grid-cols-3 md:grid-cols-6 lg:grid-cols-8 gap-2">
                                {a.analysis_data.slot_detections.map((slot, idx) => (
                                  <div key={idx} className={`p-2 rounded border text-center text-xs ${
                                    slot.is_occupied ? 'bg-red-100 border-red-300' : 'bg-green-100 border-green-300'
                                  }`}>
                                    <div className="font-semibold">Slot {slot.slot_number}</div>
                                    <div className={slot.is_occupied ? 'text-red-700' : 'text-green-700'}>
                                      {slot.is_occupied ? '🚗 Occupied' : '✅ Available'}
                                    </div>
                                    <div className="text-xs text-gray-600 mt-1">
                                      {(slot.confidence * 100).toFixed(0)}% confidence
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        )}
                        {a.processing_status === 'failed' && a.error_message && (
                          <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded text-red-800">
                            <strong>Error:</strong> {a.error_message}
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default AdminVideo;