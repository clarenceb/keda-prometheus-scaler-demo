Auto-scaling demo with KEDA and Prometheus metrics scaler
=========================================================

Basic demo showing how to use KEDA to scale a Windows deployment using NGINX Ingress Controller RPS metrics.

* RPS: `sum(rate(nginx_ingress_controller_requests[1m]))`
* RPS / number of pods: `sum(rate(nginx_ingress_controller_requests[1m])) / count(kube_pod_info{pod=~"sample.*"})`
* Scale threshold: Target RPS / pod

Example Prometheus Scaler:

```sh
  triggers:
  - type: prometheus
    metadata:
      serverAddress: http://my-release-prometheus-oper-prometheus.prometheus-operator.svc.cluster.local:9090
      metricName: nginx_ingress_controller_requests
      threshold: '10'
      query: sum(rate(nginx_ingress_controller_requests[1m])) / count(kube_pod_info{pod=~"sample.*"})
```

## Demo

Create an AKS cluster with a Windows node pool.

Install NGINX Ingress controller:

```sh
kubectl create namespace ingress-basic
helm repo add stable https://kubernetes-charts.storage.googleapis.com/

helm upgrade --install nginx-ingress stable/nginx-ingress \
    --namespace ingress-basic \
    --set controller.replicaCount=2 \
    --set controller.nodeSelector."beta\.kubernetes\.io/os"=linux \
    --set defaultBackend.nodeSelector."beta\.kubernetes\.io/os"=linux \
    --set controller.metrics.enabled=true \
    --set controller.metrics.serviceMonitor.enabled=true \
    --set controller.metrics.serviceMonitor.scrapeInterval=10s \
    --set controller.metrics.service.type=LoadBalancer

kubectl get service -l app=nginx-ingress --namespace ingress-basic
```

A Service called `nginx-ingress-controller-metrics` is exposed to expose Ingress Controller metrics in prometheus format.

```sh
kubectl port-forward service/nginx-ingress-controller-metrics 9913:9913 -n ingress-basic
``

See the prom metrics for ingress controller:

```sh
curl http://localhost:9913/metrics
```

(Optional) Set a DNS name on the Ingress external IP (required later):

```sh
# Public IP address of your ingress controller
IP="<MY_EXTERNAL_IP>"

# Name to associate with public IP address
DNSNAME="<DNS_NAME>"

# Get the resource-id of the public ip
PUBLICIPID=$(az network public-ip list --query "[?ipAddress!=null]|[?contains(ipAddress, '$IP')].[id]" --output tsv)

# Update public ip address with DNS name
az network public-ip update --ids $PUBLICIPID --dns-name $DNSNAME

# Display the FQDN
az network public-ip show --ids $PUBLICIPID --query "[dnsSettings.fqdn]" --output tsv
```

Taint windows nodes to avoid installing Linux pods onto Windows nodes:

```sh
kubectl taint node <windows_node_name> os=windows:NoSchedule
```

Install Prometheus Operator to get a monitoring stack installed:

```sh
# See: https://github.com/prometheus-operator/prometheus-operator
helm upgrade --install my-release stable/prometheus-operator \
    --namespace prometheus-operator \
    # --set prometheusOperator.nodeSelector."beta\.kubernetes\.io/os"=linux \
    # --set prometheus.prometheusSpec.nodeSelector."beta\.kubernetes\.io/os"=linux \
    # --set alertmanager.alertmanagerSpec.nodeSelector."beta\.kubernetes\.io/os"=linux \
    # --set prometheusOperator.admissionWebhooks.patch.nodeSelector."beta\.kubernetes\.io/os"=linux \
    # --set grafana.nodeSelector."beta\.kubernetes\.io/os"=linux \
    --set prometheus.prometheusSpec.serviceMonitorSelector={}

# Note: Still had issue with my-release-prometheus-node-exporter-xxxxxxx and my-release-kube-state-metrics-xxxxxxx-xxxx pods targetting windows node(s).
```

View the Grafana window:

```sh
kubectl port-forward service/my-release-grafana 8080:80 -n prometheus-operator
# Login: admin
# Password: prom-operator
```

View the Prom window:

```sh
kubectl port-forward service/my-release-prometheus-oper-prometheus 9090:9090 -n prometheus-operator
```

Run some Prom Queries:

```sh
# Graph 1:
sum(rate(nginx_ingress_controller_requests[1m])) / count(kube_pod_info{pod=~"sample.*"})

# Graph 2:
sum(rate(nginx_ingress_controller_requests[1m]))

# Table 1:
count(kube_pod_info{pod=~"sample.*"})
```

If NGINX Ingress metrics are not showing up then see: https://github.com/prometheus-operator/prometheus-operator/issues/2119
Set the `serviceMonitorSelector` to `{}`.

Install KEDA:

```sh
helm repo add kedacore https://kedacore.github.io/charts
helm repo update
kubectl create namespace keda
helm install keda kedacore/keda --namespace keda
```

Deploy the sample ASP.NET Windows app:

```sh
kubectl create ns sampleapp
kubectl apply -f aspnetapp.deploy.yaml
kubectl apply -f aspnetapp.ingress.yaml
kubectl apply -f aspnetapp.scaledobject.yaml
```

Access the app via the DNS name (expozxed via Ingress):

* http://scaledemocxb.australiaeast.cloudapp.azure.com/

Install K6 for load testing:

* https://k6.io/docs/getting-started/installation
* https://k6.io/docs/getting-started/running-k6

Monitor load on app and HPA scaling:

```sh
# termimal 1
watch kubectl top pod -n sampleapp

# terminal 2
watch kubectl get hpa -n sampleapp

# terminal 3
watch kubectl get pods -n sampleapp

# terminal 4
kubectl logs -f keda-operator-xxxxxxxx-xxxxxx -n keda
```

[Install K6](https://k6.io/docs/getting-started/installation):

```sh
sudo apt-key adv --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys 379CE192D401AB61
echo "deb https://dl.bintray.com/loadimpact/deb stable main" | sudo tee -a /etc/apt/sources.list
sudo apt-get update
sudo apt-get install k6
```

Run the load test script:

```sh
# terminal 5
k6 run script.js
```

## References

* https://github.com/prometheus-operator/prometheus-operator
* https://keda.sh/docs/1.5/concepts/scaling-deployments/#overview
* https://git.ispconfig.org/help/user/project/integrations/prometheus_library/nginx_ingress.md
* https://github.com/helm/charts/tree/master/stable/nginx-ingress#prometheus-metrics
* https://docs.microsoft.com/en-us/azure/aks/ingress-tls
* https://github.com/prometheus-operator/prometheus-operator/issues/2119
