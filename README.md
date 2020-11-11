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
      serverAddress: http://prometheus-operator-prometheus.prometheus-operator.svc.cluster.local:9090
      metricName: nginx_ingress_controller_requests
      threshold: '10'
      query: sum(rate(nginx_ingress_controller_requests[1m])) / count(kube_pod_info{pod=~"sample.*"})
```

## Demo

Create an AKS cluster then add a Windows node pool:

```sh
RESOURCE_GROUP=<resource-group>
CLUSTER=<cluster-name>

az aks nodepool add \
  --name winnp1 \
  -g $RESOURCE_GROUP \
  --cluster-name $CLUSTER \
  -k 1.18.8 \
  --node-zones 1 2 3 \
  --node-vm-size Standard_D4_v2 \
  --node-count 1 \
  --enable-cluster-autoscaler \
  --min-count 1 \
  --max-count 2 \
  --os-type Windows \
  --node-taints os=windows:NoSchedule
```

Taint windows nodes (if not already tainted) to avoid installing Linux pods onto Windows nodes:

```sh
kubectl taint node <windows_node_name> os=windows:NoSchedule
```

Install Prometheus Operator to get a monitoring stack installed:

```sh
# See: https://github.com/prometheus-operator/prometheus-operator
kubectl create ns prometheus-operator
helm upgrade --install prometheus-operator stable/prometheus-operator \
    --namespace prometheus-operator \
    --set prometheus.prometheusSpec.serviceMonitorSelector=""

# TODO: Prometheus node-exporters keep targetting Windows nodes even though they are tainted - need to fix this.

# Edit serviceMonitorSelector to look like this:
#   serviceMonitorNamespaceSelector: {}
#   serviceMonitorSelector: {}
kubectl edit prometheus -n prometheus-operator -o yaml
# TODO: Not sure how to set this via the helm --set parameter, so that's why we edit it here after installation.
```

Install NGINX Ingress controller:

```sh
kubectl create namespace ingress-public
helm repo add stable https://kubernetes-charts.storage.googleapis.com/

helm upgrade --install nginx-ingress stable/nginx-ingress \
    --namespace ingress-public \
    --set controller.replicaCount=2 \
    --set controller.nodeSelector."beta\.kubernetes\.io/os"=linux \
    --set defaultBackend.nodeSelector."beta\.kubernetes\.io/os"=linux \
    --set controller.metrics.enabled=true \
    --set controller.metrics.serviceMonitor.enabled=true \
    --set controller.metrics.serviceMonitor.scrapeInterval=10s \
    --set controller.metrics.service.type=ClusterIP

kubectl get service -l app=nginx-ingress --namespace ingress-public
```

A Service called `nginx-ingress-controller-metrics` is exposed to expose Ingress Controller metrics in prometheus format.

```sh
kubectl port-forward service/nginx-ingress-controller-metrics 9913:9913 -n ingress-public
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

View the Grafana window:

```sh
kubectl port-forward service/prometheus-operator-grafana 8080:80 -n prometheus-operator
# Login: admin
# Password: prom-operator
```

View the Prom window:

```sh
kubectl port-forward service/prometheus-operator-prometheus 9090:9090 -n prometheus-operator
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
kubectl apply -f aspnetapp.deploy.yaml -n sampleapp
# Edit aspnetapp.ingress.yaml to add your DNSNAME
kubectl apply -f aspnetapp.ingress.yaml -n sampleapp
kubectl apply -f aspnetapp.scaledobject.yaml -n sampleapp
```

Access the app via the DNS name (exposed via Ingress):

* `http://<dnsname>.<region>.cloudapp.azure.com/`

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
