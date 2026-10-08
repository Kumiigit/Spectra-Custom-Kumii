if(new URLSearchParams(location.search).has('desktop')){
  document.body.classList.add('desktop-client');
  const $=id=>document.getElementById(id);
  document.title='Spectra OCR Observer';
  document.querySelector('h1').textContent='OCR Observer';
  document.querySelector('.dashboard-header p').textContent='Pair with the broadcaster, choose your game window, then start tracking.';
  const panel=$('pair').closest('details');panel.open=true;panel.classList.add('pairing-panel');panel.querySelector('summary').textContent='Connect to broadcaster';
  document.querySelector('.dashboard-header').after(panel);
  $('forward').checked=false;
  $('forward').disabled=true;
  $('pairStatus').textContent='Enter the host’s Radmin IP, port and pairing key.';
  $('receiver').value=localStorage.getItem('spectra-ocr-receiver')||'';
  $('group').value=localStorage.getItem('spectra-ocr-group')||'VLXEUROPE';
  for(const id of ['receiver','group'])$(id).addEventListener('change',()=>localStorage.setItem(`spectra-ocr-${id}`, $(id).value));
  $('pair').addEventListener('click',()=>localStorage.setItem('spectra-ocr-receiver',$('receiver').value));
  $('bridge').textContent='Not paired';
}
