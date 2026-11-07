const PDFDocument = require('pdfkit');
const path = require('path');
const { SAFE_REASONS } = require('./domainCustomerReportService');
function duration(value) {
  if(value===null || value===undefined)return '-';
  const minutes=Math.round(value/60000);
  return minutes<60?`${minutes} min`:`${Math.floor(minutes/60)}h ${minutes%60}m`;
}
function timestamp(value) { return new Date(value).toLocaleString('en-GB',{timeZone:'Europe/Budapest',hour12:false}); }
function generateMonthlyPdf(report) {
  return new Promise((resolve,reject)=>{
    const doc=new PDFDocument({size:'A4',margin:42,bufferPages:true,info:{Title:`Monthly service report - ${report.month}`,Author:'EPDS'}});
    doc.registerFont('CustomerRegular',path.join(__dirname,'../assets/fonts/DejaVuSans.ttf'));
    doc.registerFont('CustomerBold',path.join(__dirname,'../assets/fonts/DejaVuSans-Bold.ttf'));
    const chunks=[];doc.on('data',chunk=>chunks.push(chunk));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);
    const width=doc.page.width-84;
    function heading(text,size=18){doc.fillColor('#172b4d').font('CustomerBold').fontSize(size).text(text,{width});doc.moveDown(.5);}
    function text(value,options={}){doc.fillColor('#475569').font('CustomerRegular').fontSize(10).text(value,{width,lineGap:4,...options});}
    function room(height){if(doc.y+height>doc.page.height-65)doc.addPage();}
    heading('MONTHLY SERVICE REPORT',11);heading(report.customer,25);heading(report.month,20);
    text(`${timestamp(report.from)} - ${timestamp(report.to)} (Europe/Budapest)`);
    text('Availability, observed interruptions and recovery times');doc.moveDown();
    text('Availability is time-weighted over observed time. A measurement covers at most 30 minutes. Gaps are reported as unknown, never as healthy. Incident durations are clipped to the report month. Recovery means a subsequent confirmed successful check; gaps are not treated as recoveries.');doc.moveDown();
    if(!report.domains.length)text('No monitored services were available for this report.');
    for(const item of report.domains){
      room(245);heading(item.name,17);
      const m=item.metrics;
      const metrics=[['Availability',m.uptimePercent===null?'-':`${m.uptimePercent}%`],['Measurement coverage',`${m.coveragePercent}%`],['Observed downtime',duration(m.downMs)],['Unknown time',duration(m.unknownMs)],['Interruptions',String(m.incidentCount)],['Mean recovery (month-clipped)',duration(m.meanRecoveryMs)],['Average / P95',`${m.averageMs??'-'} / ${m.p95Ms??'-'} ms`]];
      for(const [label,value] of metrics){room(22);const y=doc.y;doc.fillColor('#64748b').font('CustomerRegular').fontSize(10).text(label,42,y,{width:300});doc.fillColor('#172b4d').font('CustomerBold').text(value,345,y,{width:166,align:'right'});doc.y=y+20;}
      doc.x=42;doc.moveDown(.4);text(m.assessment);doc.moveDown();
      if(m.incidents.length){heading('Observed interruptions',12);for(const incident of m.incidents){
        const reason=SAFE_REASONS[incident.reasonCode]||'A service interruption was detected.';
        const value=`${timestamp(incident.startedAt)} - ${timestamp(incident.endedAt)} | ${duration(incident.durationMs)}\n${reason} ${incident.recovered?'Recovery confirmed.':'Recovery not confirmed within observed data.'}`;
        doc.font('CustomerRegular').fontSize(10);const height=doc.heightOfString(value,{width,lineGap:4})+15;room(height);text(value);doc.moveDown(.7);
      }}
      doc.moveDown();
    }
    const pages=doc.bufferedPageRange();for(let index=pages.start;index<pages.start+pages.count;index++){
      doc.switchToPage(index);
      const bottom=doc.page.margins.bottom;doc.page.margins.bottom=0;
      doc.fillColor('#64748b').font('CustomerRegular').fontSize(8).text(`EPDS | ${report.month} | ${index+1} / ${pages.count}`,42,doc.page.height-40,{width,align:'center',lineBreak:false});
      doc.page.margins.bottom=bottom;
    }
    doc.end();
  });
}
module.exports={generateMonthlyPdf,duration};
