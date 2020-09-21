import http from 'k6/http';
import { check, sleep } from 'k6';

export let options = {
  stages: [
    { duration: '30s', target: 50 },
    { duration: '10m', target: 500 },
    { duration: '30s', target: 0 },
  ],
};

export default function() {
  // Set your sample app ingress DNS name here
  let res = http.get('http://<dnsname>.<region>.cloudapp.azure.com/');
  check(res, { 'status was 200': r => r.status == 200 });
  sleep(1);
}
