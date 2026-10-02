# GetQuota200ResponseDaily


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**limit** | **int** |  | [optional] 
**used** | **int** |  | [optional] 
**remaining** | **int** |  | [optional] 
**reset_at** | **int** | Unix seconds, next UTC midnight | [optional] 

## Example

```python
from soroban_identity_client.models.get_quota200_response_daily import GetQuota200ResponseDaily

# TODO update the JSON string below
json = "{}"
# create an instance of GetQuota200ResponseDaily from a JSON string
get_quota200_response_daily_instance = GetQuota200ResponseDaily.from_json(json)
# print the JSON string representation of the object
print(GetQuota200ResponseDaily.to_json())

# convert the object into a dict
get_quota200_response_daily_dict = get_quota200_response_daily_instance.to_dict()
# create an instance of GetQuota200ResponseDaily from a dict
get_quota200_response_daily_from_dict = GetQuota200ResponseDaily.from_dict(get_quota200_response_daily_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


