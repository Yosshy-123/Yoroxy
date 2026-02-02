window.addEventListener('beforeunload', (event) => {
  event.preventDefault();
  event.returnValue = '';
});

const home = () => {
  const iframe = document.getElementById('proxy-iframe');
  iframe.src = '/proxy.html';
};

document.getElementById('home-btn').addEventListener('click', home);